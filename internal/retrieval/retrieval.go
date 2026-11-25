// Package retrieval implements deterministic normalization, tokenization,
// scoring and ranking, plus title similarity. All functions are pure.
package retrieval

import (
	"encoding/json"
	"math"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"capsa/internal/db"

	"golang.org/x/text/unicode/norm"
)

// SimilarityThreshold is the minimum Bigram Jaccard coefficient to flag a title.
const SimilarityThreshold = 0.6

const (
	// BodyHitWeight keeps a single body hit strictly below a summary hit (1).
	BodyHitWeight = 0.2
	// BodyScoreCap bounds the total body contribution.
	BodyScoreCap = 0.8
)

func isCJK(r rune) bool {
	return r >= '\u4e00' && r <= '\u9fff'
}

// Normalize applies NFKC normalization (skipping already-NFKC input) and
// lowercases the text. NFKC folds full-width letters, digits and spaces onto
// their ASCII equivalents so both forms match the same stored text.
func Normalize(text string) string {
	if !norm.NFKC.IsNormalString(text) {
		text = norm.NFKC.String(text)
	}
	return strings.ToLower(text)
}

// termKind classifies a search term for matching strategy.
type termKind int

const (
	// termCJK matches a contiguous CJK run as a whole literal segment.
	termCJK termKind = iota
	// termWord matches a non-CJK alphanumeric run with character-class boundaries.
	termWord
	// termLiteral matches any other (symbol-only) query literally.
	termLiteral
)

type searchTerm struct {
	text string
	kind termKind
}

// parseSearchTerms splits a query into deduplicated search terms: contiguous
// CJK runs stay whole, non-CJK alphanumeric runs become boundary-checked words,
// and a non-empty query without alphanumeric characters becomes one literal
// term so it never degrades into a full-library browse.
func parseSearchTerms(query string) []searchTerm {
	trimmed := strings.TrimSpace(Normalize(query))
	if trimmed == "" {
		return nil
	}
	terms := []searchTerm{}
	seen := map[string]struct{}{}
	add := func(term searchTerm) {
		if _, ok := seen[term.text]; ok {
			return
		}
		seen[term.text] = struct{}{}
		terms = append(terms, term)
	}
	for _, word := range words(trimmed) {
		runes := []rune(word)
		start := 0
		for start < len(runes) {
			runIsCJK := isCJK(runes[start])
			end := start
			for end < len(runes) && isCJK(runes[end]) == runIsCJK {
				end++
			}
			segment := string(runes[start:end])
			if runIsCJK {
				add(searchTerm{text: segment, kind: termCJK})
			} else {
				add(searchTerm{text: segment, kind: termWord})
			}
			start = end
		}
	}
	if len(terms) == 0 {
		return []searchTerm{{text: trimmed, kind: termLiteral}}
	}
	return terms
}

// boundaryClass groups runes for word-boundary checks: CJK and punctuation both
// count as "other", so mixed Chinese/English and hyphenated terms stay natural.
type boundaryClass int

const (
	classOther boundaryClass = iota
	classLetter
	classDigit
)

func runeBoundaryClass(r rune) boundaryClass {
	if isCJK(r) {
		return classOther
	}
	if unicode.IsLetter(r) {
		return classLetter
	}
	if unicode.IsNumber(r) {
		return classDigit
	}
	return classOther
}

// containsTerm reports whether text contains term under its matching strategy.
func containsTerm(text string, term searchTerm) bool {
	switch term.kind {
	case termCJK, termLiteral:
		return strings.Contains(text, term.text)
	}
	firstRune, _ := utf8.DecodeRuneInString(term.text)
	lastRune, _ := utf8.DecodeLastRuneInString(term.text)
	firstClass := runeBoundaryClass(firstRune)
	lastClass := runeBoundaryClass(lastRune)
	offset := 0
	for offset <= len(text)-len(term.text) {
		index := strings.Index(text[offset:], term.text)
		if index < 0 {
			return false
		}
		start := offset + index
		end := start + len(term.text)
		leftOK := start == 0
		if !leftOK {
			left, _ := utf8.DecodeLastRuneInString(text[:start])
			leftOK = runeBoundaryClass(left) != firstClass
		}
		rightOK := end == len(text)
		if !rightOK {
			right, _ := utf8.DecodeRuneInString(text[end:])
			rightOK = runeBoundaryClass(right) != lastClass
		}
		if leftOK && rightOK {
			return true
		}
		_, size := utf8.DecodeRuneInString(text[start:])
		offset = start + size
	}
	return false
}

// words splits text into runs of alphanumeric characters.
func words(text string) []string {
	out := []string{}
	var current []rune
	for _, r := range text {
		if isAlnum(r) {
			current = append(current, r)
		} else if len(current) > 0 {
			out = append(out, string(current))
			current = nil
		}
	}
	if len(current) > 0 {
		out = append(out, string(current))
	}
	return out
}

func isAlnum(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsNumber(r)
}

// tokensOf splits a word into tokens: CJK runs become consecutive bigrams, any
// other run stays whole. A length-1 CJK run remains the single character.
func tokensOf(word string) []string {
	runes := []rune(word)
	tokens := []string{}
	start := 0
	for start < len(runes) {
		runIsCJK := isCJK(runes[start])
		end := start
		for end < len(runes) && isCJK(runes[end]) == runIsCJK {
			end++
		}
		segment := runes[start:end]
		if runIsCJK && len(segment) > 1 {
			for i := 0; i < len(segment)-1; i++ {
				tokens = append(tokens, string(segment[i:i+2]))
			}
		} else {
			tokens = append(tokens, string(segment))
		}
		start = end
	}
	return tokens
}

// Tokenize returns the set of tokens of a normalized query.
func Tokenize(query string) map[string]struct{} {
	terms := map[string]struct{}{}
	for _, word := range words(Normalize(query)) {
		for _, token := range tokensOf(word) {
			terms[token] = struct{}{}
		}
	}
	return terms
}

// Four-tier memory lifecycle constants.
const (
	TierPersistent = "persistent"
	TierTemporary  = "temporary"
	TierShallow    = "shallow"
	TierDeep       = "deep"
)

// SearchFields controls which memory fields participate in keyword matching and scoring.
type SearchFields struct {
	Title   bool
	Summary bool
	Tags    bool
	Body    bool
}

// DefaultSearchFields matches title, summary and tags without loading body.
var DefaultSearchFields = SearchFields{Title: true, Summary: true, Tags: true}

// NormalizeTimestamp parses an ISO 8601 timestamp and re-renders it in UTC
// using the fixed-width storage layout. A value without an offset is read as UTC.
func NormalizeTimestamp(value string) (string, error) {
	moment, err := db.ParseTimestamp(value)
	if err != nil {
		return "", err
	}
	return moment.Format("2006-01-02T15:04:05.000000-07:00"), nil
}

// IsPersistent reports whether a memory row is marked persistent (stored in
// pinned or already mapped to persistent).
func IsPersistent(memory map[string]any) bool {
	if value, ok := memory["persistent"].(bool); ok {
		return value
	}
	return pinnedOf(memory)
}

func shallowMonthsOf(memory map[string]any) int {
	switch value := memory["shallow_months"].(type) {
	case int:
		if value > 0 {
			return value
		}
	case int64:
		if value > 0 {
			return int(value)
		}
	case float64:
		if value > 0 {
			return int(value)
		}
	}
	return db.DefaultShallowMonths
}

// ComputeTier dynamically classifies an active memory into persistent,
// temporary, shallow or deep based on its owning workspace's shallow_months.
func ComputeTier(memory map[string]any, now time.Time) string {
	if IsPersistent(memory) {
		return TierPersistent
	}
	if stringField(memory, "expires_at") != "" {
		return TierTemporary
	}
	months := shallowMonthsOf(memory)
	cutoff := now.UTC().AddDate(0, -months, 0)
	updatedAt, err := db.ParseTimestamp(stringField(memory, "updated_at"))
	if err != nil {
		return TierShallow
	}
	if !updatedAt.Before(cutoff) {
		return TierShallow
	}
	return TierDeep
}

// LayerOf maps a memory to its search/catalog layer: "trash", "deep" or "shallow".
func LayerOf(memory map[string]any, now time.Time) string {
	if stringField(memory, "deleted_at") != "" {
		return "trash"
	}
	if ComputeTier(memory, now) == TierDeep {
		return "deep"
	}
	return "shallow"
}

// TierPriority returns the unified sort bucket: persistent (0) < temporary (1) < other (2).
func TierPriority(memory map[string]any) int {
	if IsPersistent(memory) {
		return 0
	}
	if stringField(memory, "expires_at") != "" {
		return 1
	}
	return 2
}

// TitleSimilarity returns the Bigram Jaccard coefficient of two titles.
func TitleSimilarity(left, right string) float64 {
	leftTokens := Tokenize(left)
	rightTokens := Tokenize(right)
	union := map[string]struct{}{}
	for token := range leftTokens {
		union[token] = struct{}{}
	}
	for token := range rightTokens {
		union[token] = struct{}{}
	}
	if len(union) == 0 {
		return 0.0
	}
	shared := 0
	for token := range leftTokens {
		if _, ok := rightTokens[token]; ok {
			shared++
		}
	}
	return float64(shared) / float64(len(union))
}

// FindSimilarMemories returns candidates at or above the threshold, each
// annotated with a rounded similarity and sorted by similarity descending.
func FindSimilarMemories(candidates []map[string]any, title string, threshold float64) []map[string]any {
	similar := []map[string]any{}
	for _, memory := range candidates {
		score := TitleSimilarity(title, stringField(memory, "title"))
		if score >= threshold {
			item := map[string]any{}
			for key, value := range memory {
				item[key] = value
			}
			item["similarity"] = round2(score)
			similar = append(similar, item)
		}
	}
	sort.SliceStable(similar, func(i, j int) bool {
		return similar[i]["similarity"].(float64) > similar[j]["similarity"].(float64)
	})
	return similar
}

// ScoreWithFields computes the weighted score of a memory for a token set using
// only the enabled fields. Every token must hit an enabled field; otherwise the
// score is 0.
func ScoreWithFields(memory map[string]any, terms map[string]struct{}, fields SearchFields) float64 {
	score, _ := scoreMemoryWithFields(memory, terms, fields)
	return score
}

func scoreMemoryWithFields(memory map[string]any, terms map[string]struct{}, fields SearchFields) (float64, bool) {
	classified := make([]searchTerm, 0, len(terms))
	for term := range terms {
		classified = append(classified, classifySearchToken(term))
	}
	return scoreMemoryWithTerms(memory, classified, fields)
}

// classifySearchToken maps a pre-tokenized term onto its matching strategy:
// CJK runs stay whole, alphanumeric runs are boundary-checked words.
func classifySearchToken(text string) searchTerm {
	allCJK := len(text) > 0
	for _, r := range text {
		if !isCJK(r) {
			allCJK = false
			break
		}
	}
	if allCJK {
		return searchTerm{text: text, kind: termCJK}
	}
	return searchTerm{text: text, kind: termWord}
}

// scoreMemoryWithTerms applies conjunctive matching: every term must hit at
// least one enabled field, otherwise the memory is not a hit. Scores are only
// accumulated after the term set is fully satisfied.
func scoreMemoryWithTerms(memory map[string]any, terms []searchTerm, fields SearchFields) (float64, bool) {
	if len(terms) == 0 {
		return 0, false
	}
	title, summary, body := "", "", ""
	var tags []string
	if fields.Title {
		title = Normalize(stringField(memory, "title"))
	}
	if fields.Summary {
		summary = Normalize(stringField(memory, "summary"))
	}
	if fields.Tags {
		rawTags := tagsOf(memory)
		tags = make([]string, len(rawTags))
		for i, tag := range rawTags {
			tags[i] = Normalize(tag)
		}
	}
	if fields.Body {
		body = Normalize(stringField(memory, "body"))
	}
	total := 0.0
	bodyScore := 0.0
	for _, term := range terms {
		hit := false
		if fields.Title && containsTerm(title, term) {
			total += 4
			hit = true
		}
		if fields.Tags {
			for _, tag := range tags {
				if containsTerm(tag, term) {
					total += 2
					hit = true
					break
				}
			}
		}
		if fields.Summary && containsTerm(summary, term) {
			total += 1
			hit = true
		}
		if fields.Body && containsTerm(body, term) {
			bodyScore += BodyHitWeight
			hit = true
		}
		if !hit {
			return 0, false
		}
	}
	total += math.Min(bodyScore, BodyScoreCap)
	if IsPersistent(memory) {
		total += 3
	}
	return round2(total), true
}

type rankedEntry struct {
	memory   map[string]any
	id       string
	priority int
	epoch    float64
	score    float64
}

// RankMemoriesWithFields returns a ranked copy of the input ordered by score
// (when query has tokens), unified tier priority (persistent < temporary <
// other), update time descending and id descending.
func RankMemoriesWithFields(memories []map[string]any, query string, fields SearchFields) []map[string]any {
	terms := parseSearchTerms(query)
	if len(terms) == 0 {
		entries := make([]rankedEntry, len(memories))
		for i, memory := range memories {
			entries[i] = rankedEntry{
				memory:   memory,
				id:       stringField(memory, "id"),
				priority: TierPriority(memory),
				epoch:    epochOf(memory),
			}
		}
		sort.SliceStable(entries, func(i, j int) bool {
			if entries[i].priority != entries[j].priority {
				return entries[i].priority < entries[j].priority
			}
			if entries[i].epoch != entries[j].epoch {
				return entries[i].epoch > entries[j].epoch
			}
			return entries[i].id > entries[j].id
		})
		out := make([]map[string]any, len(entries))
		for i, entry := range entries {
			out[i] = entry.memory
		}
		return out
	}

	entries := make([]rankedEntry, 0, len(memories))
	for _, memory := range memories {
		score, hit := scoreMemoryWithTerms(memory, terms, fields)
		if !hit {
			continue
		}
		entries = append(entries, rankedEntry{
			memory:   memory,
			id:       stringField(memory, "id"),
			priority: TierPriority(memory),
			epoch:    epochOf(memory),
			score:    score,
		})
	}
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].score != entries[j].score {
			return entries[i].score > entries[j].score
		}
		if entries[i].priority != entries[j].priority {
			return entries[i].priority < entries[j].priority
		}
		if entries[i].epoch != entries[j].epoch {
			return entries[i].epoch > entries[j].epoch
		}
		return entries[i].id > entries[j].id
	})
	out := make([]map[string]any, len(entries))
	for i, entry := range entries {
		out[i] = entry.memory
	}
	return out
}

func epochOf(memory map[string]any) float64 {
	moment, err := db.ParseTimestamp(stringField(memory, "updated_at"))
	if err != nil {
		return 0
	}
	return float64(moment.UnixNano()) / 1e9
}

func round2(value float64) float64 {
	// Round half to even, matching Python's round() used by the original layer.
	return math.RoundToEven(value*100) / 100
}

// stringField reads a string field, treating nil as empty.
func stringField(memory map[string]any, key string) string {
	if value, ok := memory[key].(string); ok {
		return value
	}
	return ""
}

func pinnedOf(memory map[string]any) bool {
	switch value := memory["pinned"].(type) {
	case bool:
		return value
	case int:
		return value != 0
	case int64:
		return value != 0
	case float64:
		return value != 0
	default:
		return false
	}
}

// DecodeTags decodes a tags field from a JSON string or an already-decoded
// string/any slice.
func DecodeTags(raw any) []string {
	switch value := raw.(type) {
	case []string:
		return value
	case []any:
		out := make([]string, 0, len(value))
		for _, item := range value {
			if text, ok := item.(string); ok {
				out = append(out, text)
			}
		}
		return out
	case string:
		out := []string{}
		if value == "" {
			return out
		}
		_ = json.Unmarshal([]byte(value), &out)
		return out
	default:
		return []string{}
	}
}

func tagsOf(memory map[string]any) []string {
	return DecodeTags(memory["tags"])
}
