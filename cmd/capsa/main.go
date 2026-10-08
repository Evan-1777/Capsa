// Command capsa is the single entrypoint: the HTTP service plus the offline
// administrative CLI. Uses only the standard library.
package main

import (
	"database/sql"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"capsa/internal/auth"
	"capsa/internal/dal"
	"capsa/internal/db"
	"capsa/internal/ids"
	"capsa/internal/retrieval"
	"capsa/internal/server"
)

const (
	backupKeepDays = 14
	backupDir      = "/backup"
	backupPrefix   = "capsa-"
)

// defaultGroups are preloaded by `capsa init`.
var defaultGroups = [][3]string{
	{"proj", "项目", "项目相关记忆：架构决策、实施进度与接口约定"},
	{"study", "学习", "学习笔记：技术原理、资料摘要与练习记录"},
	{"life", "生活", "生活记录：计划、清单与日常事务"},
	{"track", "追踪", "需要按期复核的追踪事项"},
}

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	if len(args) == 0 {
		usage()
		return 2
	}
	switch args[0] {
	case "init":
		return cmdInit()
	case "group":
		return cmdGroup(args[1:])
	case "key":
		return cmdKey(args[1:])
	case "memory":
		return cmdMemory(args[1:])
	case "review":
		return cmdReview(args[1:])
	case "backup":
		return cmdBackup(args[1:])
	case "restore":
		return cmdRestore(args[1:])
	case "serve":
		return cmdServe(args[1:])
	default:
		usage()
		return 2
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "用法: capsa <init|group|key|memory|review|backup|restore|serve> ...")
}

func connect() (*sql.DB, error) {
	handle, err := db.Connect()
	if err != nil {
		return nil, err
	}
	if err := db.InitSchema(handle); err != nil {
		handle.Close()
		return nil, err
	}
	return handle, nil
}

func fail(format string, args ...any) int {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	return 1
}

type boolFlag interface{ IsBoolFlag() bool }

// parseInterspersed lets flags follow positional arguments, matching the
// argparse behavior of the original CLI. It splits the arguments, parses the
// flags, and returns the positionals.
func parseInterspersed(fs *flag.FlagSet, args []string) ([]string, error) {
	flagArgs := []string{}
	positionals := []string{}
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if len(arg) > 1 && arg[0] == '-' {
			flagArgs = append(flagArgs, arg)
			if strings.Contains(arg, "=") {
				continue
			}
			name := strings.TrimLeft(arg, "-")
			element := fs.Lookup(name)
			if element == nil {
				continue
			}
			if bf, ok := element.Value.(boolFlag); ok && bf.IsBoolFlag() {
				continue
			}
			if i+1 < len(args) {
				i++
				flagArgs = append(flagArgs, args[i])
			}
			continue
		}
		positionals = append(positionals, arg)
	}
	if err := fs.Parse(flagArgs); err != nil {
		return nil, err
	}
	return positionals, nil
}

func cmdInit() int {
	handle, err := connect()
	if err != nil {
		return fail("初始化失败：%v", err)
	}
	defer handle.Close()
	slugs := make([]string, 0, len(defaultGroups))
	for _, group := range defaultGroups {
		if _, err := dal.AddGroup(handle, group[0], group[1], group[2]); err != nil {
			return fail("初始化失败：%v", err)
		}
		slugs = append(slugs, group[0])
	}
	fmt.Printf("已预置标准分组：%s\n", strings.Join(slugs, ", "))
	return 0
}

func cmdGroup(args []string) int {
	if len(args) == 0 {
		return fail("用法: capsa group <add|list|delete> ...")
	}
	switch args[0] {
	case "add":
		flags := flag.NewFlagSet("group add", flag.ContinueOnError)
		description := flags.String("desc", "", "分组描述")
		positional, err := parseInterspersed(flags, args[1:])
		if err != nil {
			return 2
		}
		if len(positional) < 2 {
			return fail("用法: capsa group add <slug> <name> [--desc 描述]")
		}
		handle, err := connect()
		if err != nil {
			return fail("连接数据库失败：%v", err)
		}
		defer handle.Close()
		inserted, err := dal.AddGroup(handle, positional[0], positional[1], *description)
		if err != nil {
			return fail("新增分组失败：%v", err)
		}
		if !inserted {
			return fail("分组 %s 已存在，未修改", positional[0])
		}
		group, err := dal.GetGroup(handle, positional[0])
		if err != nil || group == nil {
			return fail("读取分组失败")
		}
		fmt.Printf("分组 %s | %s | %s\n", group["slug"], group["name"], group["description"])
		return 0
	case "list":
		handle, err := connect()
		if err != nil {
			return fail("连接数据库失败：%v", err)
		}
		defer handle.Close()
		groups, err := dal.ListGroups(handle)
		if err != nil {
			return fail("列出分组失败：%v", err)
		}
		for _, group := range groups {
			fmt.Printf("%s | %s | %s\n", group["slug"], group["name"], group["description"])
		}
		return 0
	case "delete":
		if len(args) < 2 {
			return fail("用法: capsa group delete <slug>")
		}
		handle, err := connect()
		if err != nil {
			return fail("连接数据库失败：%v", err)
		}
		defer handle.Close()
		status, err := dal.DeleteEmptyGroup(handle, args[1])
		if err != nil {
			return fail("删除分组失败：%v", err)
		}
		switch status {
		case "not_found":
			return fail("未找到分组：%s", args[1])
		case "has_memories":
			return fail("分组 %s 下仍有记忆（含回收站），无法删除", args[1])
		}
		fmt.Printf("已删除分组：%s\n", args[1])
		return 0
	default:
		return fail("用法: capsa group <add|list|delete> ...")
	}
}

func parseScopes(raw string) map[string]string {
	scopes := map[string]string{}
	for _, pair := range strings.Split(raw, ",") {
		pair = strings.TrimSpace(pair)
		if pair == "" {
			continue
		}
		slug, permission, hasSeparator := strings.Cut(pair, ":")
		slug = strings.TrimSpace(slug)
		if !hasSeparator {
			permission = "r"
		} else {
			permission = strings.TrimSpace(permission)
		}
		if slug != "" {
			scopes[slug] = permission
		}
	}
	return scopes
}

func cmdKey(args []string) int {
	if len(args) == 0 {
		return fail("用法: capsa key <create|list|revoke> ...")
	}
	switch args[0] {
	case "create":
		flags := flag.NewFlagSet("key create", flag.ContinueOnError)
		scopesFlag := flags.String("scopes", "", "形如 proj:rw,study:r")
		positional, err := parseInterspersed(flags, args[1:])
		if err != nil {
			return 2
		}
		if len(positional) < 1 {
			return fail("用法: capsa key create <name> --scopes proj:rw,study:r")
		}
		name := strings.TrimSpace(positional[0])
		if name == "" || len([]rune(name)) > 60 {
			return fail("Key 名称不能为空且不超过 60 字符")
		}
		scopes := parseScopes(*scopesFlag)
		if len(scopes) == 0 {
			return fail("scopes 不能为空")
		}
		handle, err := connect()
		if err != nil {
			return fail("连接数据库失败：%v", err)
		}
		defer handle.Close()
		groups, err := dal.ListGroups(handle)
		if err != nil {
			return fail("读取分组失败：%v", err)
		}
		existing := map[string]bool{}
		for _, group := range groups {
			existing[group["slug"].(string)] = true
		}
		for slug, permission := range scopes {
			if slug != "*" && !existing[slug] {
				return fail("未找到分组：%s", slug)
			}
			if permission != "r" && permission != "rw" {
				return fail("权限值必须是 r 或 rw，本次传入 %s", permission)
			}
		}
		keyID, plain := auth.IssueKey()
		if err := dal.CreateKey(handle, keyID, name, ids.HashToken(plain), scopes); err != nil {
			return fail("签发 Key 失败：%v", err)
		}
		fmt.Printf("Key ID: %s\n", keyID)
		fmt.Printf("令牌: %s\n", plain)
		fmt.Println("明文令牌仅本次显示，服务端只存 SHA256，之后无法找回。")
		return 0
	case "list":
		handle, err := connect()
		if err != nil {
			return fail("连接数据库失败：%v", err)
		}
		defer handle.Close()
		keys, err := dal.ListKeys(handle)
		if err != nil {
			return fail("列出 Key 失败：%v", err)
		}
		for _, key := range keys {
			state := "有效"
			if revoked, ok := key["revoked_at"].(string); ok && revoked != "" {
				state = "已撤销 " + revoked
			}
			fmt.Printf("%s | %s | %s | %s\n", key["id"], key["name"], formatScopes(key["scopes"]), state)
		}
		return 0
	case "revoke":
		if len(args) < 2 {
			return fail("用法: capsa key revoke <key_id>")
		}
		handle, err := connect()
		if err != nil {
			return fail("连接数据库失败：%v", err)
		}
		defer handle.Close()
		status, err := dal.RevokeKey(handle, args[1])
		if err != nil {
			return fail("撤销 Key 失败：%v", err)
		}
		if status != "revoked" {
			return fail("未找到可撤销的 Key：%s", args[1])
		}
		fmt.Printf("已撤销 Key：%s\n", args[1])
		return 0
	default:
		return fail("用法: capsa key <create|list|revoke> ...")
	}
}

// formatScopes renders a scope map in the Python dict-repr style used by the
// original CLI, with sorted keys for determinism.
func formatScopes(value any) string {
	scopes, ok := value.(map[string]string)
	if !ok {
		return "{}"
	}
	keys := make([]string, 0, len(scopes))
	for key := range scopes {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, fmt.Sprintf("'%s': '%s'", key, scopes[key]))
	}
	return "{" + strings.Join(parts, ", ") + "}"
}

func cmdMemory(args []string) int {
	if len(args) == 0 {
		return fail("用法: capsa memory <list-deleted|restore> ...")
	}
	switch args[0] {
	case "list-deleted":
		flags := flag.NewFlagSet("memory list-deleted", flag.ContinueOnError)
		group := flags.String("group", "", "只列出指定分组")
		if err := flags.Parse(args[1:]); err != nil {
			return 2
		}
		handle, err := connect()
		if err != nil {
			return fail("连接数据库失败：%v", err)
		}
		defer handle.Close()
		entries, err := dal.ListDeletedMemories(handle, *group)
		if err != nil {
			return fail("列出回收站失败：%v", err)
		}
		if len(entries) == 0 {
			fmt.Println("回收站为空")
			return 0
		}
		for _, entry := range entries {
			fmt.Printf("%s | %s | 删除于 %s | 原因: %s\n",
				entry["id"], entry["group_slug"], entry["deleted_at"], entry["deleted_reason"])
		}
		return 0
	case "restore":
		if len(args) < 2 {
			return fail("用法: capsa memory restore <memory_id>")
		}
		handle, err := connect()
		if err != nil {
			return fail("连接数据库失败：%v", err)
		}
		defer handle.Close()
		restored, err := dal.RestoreMemory(handle, args[1])
		if err != nil {
			return fail("恢复记忆失败：%v", err)
		}
		if !restored {
			return fail("未找到可恢复的记忆：%s", args[1])
		}
		fmt.Printf("已恢复记忆：%s\n", args[1])
		return 0
	default:
		return fail("用法: capsa memory <list-deleted|restore> ...")
	}
}

func cmdReview(args []string) int {
	flags := flag.NewFlagSet("review", flag.ContinueOnError)
	group := flags.String("group", "", "只审阅指定分组")
	query := flags.String("query", "", "关键词，与 MCP memory_search 同源")
	limit := flags.Int("limit", 20, "最多输出条数")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	handle, err := connect()
	if err != nil {
		return fail("连接数据库失败：%v", err)
	}
	defer handle.Close()
	groups, err := dal.ListGroups(handle)
	if err != nil {
		return fail("读取分组失败：%v", err)
	}
	// CLI 是管理员通道：按读写权限取出全部已建分组。
	scopes := map[string]string{}
	for _, item := range groups {
		scopes[item["slug"].(string)] = "rw"
	}
	memories, err := dal.ListActiveMemoriesForSearch(handle, scopes, *group, false)
	if err != nil {
		return fail("读取记忆失败：%v", err)
	}
	ranked := retrieval.RankMemories(memories, *query, time.Now().UTC(), false)
	if len(ranked) > *limit {
		ranked = ranked[:*limit]
	}
	if len(ranked) == 0 {
		fmt.Println("没有符合条件的记忆")
		return 0
	}
	for index, item := range ranked {
		updated := item["updated_at"].(string)
		fmt.Printf("[%d] %s | %s | %s | %s\n", index+1, item["id"], item["group_slug"], updated[:10], item["title"])
	}
	return 0
}

func cmdBackup(args []string) int {
	flags := flag.NewFlagSet("backup", flag.ContinueOnError)
	keepDays := flags.Int("keep-days", backupKeepDays, "保留天数")
	positional, err := parseInterspersed(flags, args)
	if err != nil {
		return 2
	}
	targetDir := ""
	if len(positional) > 0 {
		targetDir = positional[0]
	}
	if targetDir == "" {
		targetDir = os.Getenv("CAPSA_BACKUP_DIR")
	}
	if targetDir == "" {
		targetDir = backupDir
	}
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return fail("创建备份目录失败：%v", err)
	}
	snapshot := filepath.Join(targetDir, backupPrefix+db.UtcNow()[:10]+".db")
	_ = os.Remove(snapshot)
	handle, err := db.Connect()
	if err != nil {
		return fail("连接数据库失败：%v", err)
	}
	defer handle.Close()
	if _, err := handle.Exec("VACUUM INTO ?", snapshot); err != nil {
		return fail("生成快照失败：%v", err)
	}
	fmt.Printf("已生成快照：%s\n", snapshot)

	cutoff := time.Now().UTC().AddDate(0, 0, -*keepDays)
	matches, _ := filepath.Glob(filepath.Join(targetDir, backupPrefix+"*.db"))
	removed := 0
	for _, path := range matches {
		name := filepath.Base(path)
		dateText := strings.TrimSuffix(strings.TrimPrefix(name, backupPrefix), ".db")
		created, err := time.Parse("2006-01-02", dateText)
		if err != nil {
			continue
		}
		if !created.After(cutoff) {
			if err := os.Remove(path); err == nil {
				removed++
			}
		}
	}
	fmt.Printf("已清理 %d 个过期快照\n", removed)
	return 0
}

func cmdRestore(args []string) int {
	if len(args) < 1 {
		return fail("用法: capsa restore <snapshot_path>")
	}
	source := args[0]
	if info, err := os.Stat(source); err != nil || info.IsDir() {
		return fail("未找到快照文件：%s", source)
	}
	target := db.DBPath()
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return fail("创建目标目录失败：%v", err)
	}
	if err := copyFile(source, target); err != nil {
		return fail("恢复失败：%v", err)
	}
	// A stale WAL would shadow the restored file.
	_ = os.Remove(target + "-wal")
	_ = os.Remove(target + "-shm")
	fmt.Printf("已恢复：%s 到 %s，请重启服务\n", source, target)
	return 0
}

// copyFile overwrites target with the contents of source. ponytail: restore is
// an offline admin action; a plain copy of a VACUUM snapshot is consistent and
// the service is restarted afterward.
func copyFile(source, target string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.Create(target)
	if err != nil {
		return err
	}
	defer output.Close()
	if _, err := io.Copy(output, input); err != nil {
		return err
	}
	return output.Sync()
}

func cmdServe(args []string) int {
	flags := flag.NewFlagSet("serve", flag.ContinueOnError)
	host := flags.String("host", "0.0.0.0", "监听地址")
	port := flags.Int("port", 8000, "监听端口")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	address := fmt.Sprintf("%s:%d", *host, *port)
	fmt.Printf("capsa 服务已启动：http://%s\n", address)
	if err := http.ListenAndServe(address, server.NewHandler()); err != nil {
		return fail("服务启动失败：%v", err)
	}
	return 0
}
