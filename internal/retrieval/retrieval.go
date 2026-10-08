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

// Normalize applies NFC normalization and lowercases the text.
func Normalize(text string) string {
	return strings.ToLower(norm.NFC.String(text))
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

// NormalizeReviewAt parses an ISO 8601 timestamp and re-renders it in UTC using
// the fixed-width storage layout. A value without an offset is read as UTC.
func NormalizeReviewAt(value string) (string, error) {
	moment, err := db.ParseTimestamp(value)
	if err != nil {
		return "", err
	}
	return moment.Format("2006-01-02T15:04:05.000000-07:00"), nil
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

// IsExpired reports whether a review timestamp lies in the past.
func IsExpired(reviewAt *string, now time.Time) bool {
	if reviewAt == nil || *reviewAt == "" {
		return false
	}
	moment, err := db.ParseTimestamp(*reviewAt)
	if err != nil {
		return false
	}
	return moment.Before(now)
}

// Score computes the weighted score of a memory for a token set.
func Score(memory map[string]any, terms map[string]struct{}, now time.Time, includeBody bool) float64 {
	title := Normalize(stringField(memory, "title"))
	summary := Normalize(stringField(memory, "summary"))
	tags := []string{}
	for _, tag := range tagsOf(memory) {
		tags = append(tags, Normalize(tag))
	}
	total := 0.0
	for term := range terms {
		if strings.Contains(title, term) {
			total += 4
		}
	}
	for term := range terms {
		if strings.Contains(summary, term) {
			total += 1
		}
	}
	for term := range terms {
		for _, tag := range tags {
			if strings.Contains(tag, term) {
				total += 2
				break
			}
		}
	}
	if includeBody {
		body := Normalize(stringField(memory, "body"))
		bodyScore := 0.0
		for term := range terms {
			if strings.Contains(body, term) {
				bodyScore += BodyHitWeight
			}
		}
		total += math.Min(bodyScore, BodyScoreCap)
	}
	if pinnedOf(memory) {
		total += 3
	}
	if IsExpired(stringPtrField(memory, "review_at"), now) {
		total -= 2
	}
	return round2(total)
}

// hits reports whether any term matches a searchable field. Pinned and expiry
// are ranking weights, not hits.
func hits(memory map[string]any, terms map[string]struct{}, includeBody bool) bool {
	fields := []string{Normalize(stringField(memory, "title")), Normalize(stringField(memory, "summary"))}
	for _, tag := range tagsOf(memory) {
		fields = append(fields, Normalize(tag))
	}
	if includeBody {
		fields = append(fields, Normalize(stringField(memory, "body")))
	}
	for term := range terms {
		for _, field := range fields {
			if strings.Contains(field, term) {
				return true
			}
		}
	}
	return false
}

// RankMemories returns a ranked copy of the input. Two stable passes fix the
// descending id tie-breaker first, then order by score, pinned flag and update time.
func RankMemories(memories []map[string]any, query string, now time.Time, includeBody bool) []map[string]any {
	ranked := make([]map[string]any, len(memories))
	copy(ranked, memories)
	sort.SliceStable(ranked, func(i, j int) bool {
		return stringField(ranked[i], "id") > stringField(ranked[j], "id")
	})
	terms := Tokenize(query)
	if len(terms) == 0 {
		sort.SliceStable(ranked, func(i, j int) bool {
			return browseKey(ranked[i]).after(browseKey(ranked[j]))
		})
		return ranked
	}
	filtered := make([]map[string]any, 0, len(ranked))
	for _, memory := range ranked {
		if hits(memory, terms, includeBody) {
			filtered = append(filtered, memory)
		}
	}
	scores := make(map[string]float64, len(filtered))
	for _, memory := range filtered {
		scores[stringField(memory, "id")] = Score(memory, terms, now, includeBody)
	}
	sort.SliceStable(filtered, func(i, j int) bool {
		left, right := filtered[i], filtered[j]
		leftScore, rightScore := scores[stringField(left, "id")], scores[stringField(right, "id")]
		if leftScore != rightScore {
			return leftScore > rightScore
		}
		leftPinned, rightPinned := pinnedOf(left), pinnedOf(right)
		if leftPinned != rightPinned {
			return leftPinned
		}
		return epochOf(left) > epochOf(right)
	})
	return filtered
}

type browseOrder struct {
	pinned bool
	epoch  float64
}

func (o browseOrder) after(other browseOrder) bool {
	if o.pinned != other.pinned {
		return o.pinned
	}
	return o.epoch > other.epoch
}

func browseKey(memory map[string]any) browseOrder {
	return browseOrder{pinned: pinnedOf(memory), epoch: epochOf(memory)}
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

func stringPtrField(memory map[string]any, key string) *string {
	if value, ok := memory[key].(string); ok {
		return &value
	}
	return nil
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

// tagsOf decodes the tags field, which the DAL returns as a raw JSON string but
// a transport layer may already have decoded into a slice.
func tagsOf(memory map[string]any) []string {
	switch value := memory["tags"].(type) {
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
