import { Check, Copy } from "lucide-react";
import { isValidElement, type ReactNode, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractText(node.props.children);
  }
  return "";
}

function stripNode<T extends { node?: unknown }>({ node: _node, ...rest }: T): Omit<T, "node"> {
  return rest;
}

// hast-util-to-jsx-runtime converts HAST `align` on th/td to `style.textAlign` before calling components.
function cellAlignClass(
  align?: string,
  textAlign?: React.CSSProperties["textAlign"],
): string {
  const value = align ?? (typeof textAlign === "string" ? textAlign : "");
  if (value === "center") return "text-center";
  if (value === "right") return "text-right";
  return "text-left";
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const child = Array.isArray(children)
    ? children.find((item) => isValidElement(item))
    : children;
  const className = isValidElement<{ className?: string }>(child)
    ? (child.props.className ?? "")
    : "";
  const match = className.match(/(?:^|\s)language-([\w-]+)/);
  const language = match ? match[1] : "text";
  const text = extractText(children).replace(/\n$/, "");

  async function copyCode() {
    try {
      if (!navigator.clipboard) return;
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable in restricted contexts; ignore silently.
    }
  }

  return (
    <div className="my-3 overflow-hidden rounded-md border border-outline-variant bg-surface-container-low">
      <div className="flex items-center justify-between border-b border-outline-variant bg-surface-container px-3 py-1.5">
        <span className="font-mono text-label-small text-on-surface-variant">{language}</span>
        <button
          type="button"
          aria-label="复制代码"
          onClick={copyCode}
          className="md-state-layer inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-label-small text-on-surface-variant transition-colors hover:text-on-surface focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-success" aria-hidden />
              <span>已复制</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" aria-hidden />
              <span>复制</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 font-mono text-body-small leading-relaxed text-on-surface">
        {text}
      </pre>
    </div>
  );
}

/**
 * 记忆与文档正文可能来自任意 Agent，渲染管线按不可信内容处理：
 * skipHtml 关闭内联 HTML，remark-gfm 提供扩展语法，rehype-sanitize
 * 用默认 GitHub 白名单过滤标签、事件属性与 javascript:/data: 伪协议。
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-body-large leading-relaxed text-on-surface break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          h1: ({ className = "", ...props }) => (
            <h1
              className={`mt-6 mb-3 border-b border-outline-variant pb-2 text-headline-small font-semibold text-on-surface ${className}`}
              {...stripNode(props)}
            />
          ),
          h2: ({ className = "", ...props }) => (
            <h2
              className={`mt-6 mb-2.5 border-b border-outline-variant pb-1.5 text-title-large font-semibold text-on-surface ${className}`}
              {...stripNode(props)}
            />
          ),
          h3: ({ className = "", ...props }) => (
            <h3
              className={`mt-5 mb-2 text-title-medium font-semibold text-on-surface ${className}`}
              {...stripNode(props)}
            />
          ),
          h4: ({ className = "", ...props }) => (
            <h4
              className={`mt-4 mb-1.5 text-title-small font-semibold text-on-surface ${className}`}
              {...stripNode(props)}
            />
          ),
          h5: ({ className = "", ...props }) => (
            <h5
              className={`mt-3 mb-1 text-label-large text-on-surface-variant ${className}`}
              {...stripNode(props)}
            />
          ),
          h6: ({ className = "", ...props }) => (
            <h6
              className={`mt-3 mb-1 text-label-large text-on-surface-variant ${className}`}
              {...stripNode(props)}
            />
          ),
          p: ({ className = "", ...props }) => (
            <p className={`my-3 leading-relaxed text-on-surface ${className}`} {...stripNode(props)} />
          ),
          ul: ({ className = "", ...props }) => {
            const isTaskList = className.includes("contains-task-list");
            return (
              <ul
                className={
                  isTaskList
                    ? `my-2.5 list-none space-y-1.5 pl-1 ${className}`
                    : `my-2.5 list-disc space-y-1 pl-6 [&_ul]:my-1 [&_ol]:my-1 ${className}`
                }
                {...stripNode(props)}
              />
            );
          },
          ol: ({ className = "", ...props }) => {
            const isTaskList = className.includes("contains-task-list");
            return (
              <ol
                className={
                  isTaskList
                    ? `my-2.5 list-none space-y-1.5 pl-1 ${className}`
                    : `my-2.5 list-decimal space-y-1 pl-6 [&_ul]:my-1 [&_ol]:my-1 ${className}`
                }
                {...stripNode(props)}
              />
            );
          },
          li: ({ className = "", ...props }) => {
            const isTaskItem = className.includes("task-list-item");
            return (
              <li
                className={
                  isTaskItem
                    ? `list-none pl-6 [&>input]:-ml-5 [&>p]:my-0 [&>p>input]:-ml-5 ${className}`
                    : `[&>p]:my-0 ${className}`
                }
                {...stripNode(props)}
              />
            );
          },
          input: ({ className = "", ...props }) => (
            <input
              className={`mr-2 h-4 w-4 rounded-xs accent-primary align-middle ${className}`}
              {...stripNode(props)}
            />
          ),
          blockquote: ({ className = "", ...props }) => (
            <blockquote
              className={`my-3 rounded-r-sm border-l-4 border-primary bg-surface-container-low px-4 py-2.5 text-on-surface-variant [&>p]:my-1 ${className}`}
              {...stripNode(props)}
            />
          ),
          hr: ({ className = "", ...props }) => (
            <hr className={`my-6 border-0 border-t border-outline-variant ${className}`} {...stripNode(props)} />
          ),
          del: ({ className = "", ...props }) => (
            <del className={`text-on-surface-variant line-through ${className}`} {...stripNode(props)} />
          ),
          img: ({ className = "", alt = "", ...props }) => (
            <img
              alt={alt}
              className={`my-3 h-auto max-w-full rounded-md border border-outline-variant ${className}`}
              {...stripNode(props)}
            />
          ),
          code: ({ className = "", ...props }) => (
            <code
              className={`rounded-xs border border-outline-variant bg-surface-container px-1.5 py-0.5 font-mono text-body-small text-on-surface break-words ${className}`}
              {...stripNode(props)}
            />
          ),
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          table: ({ className = "", ...props }) => (
            <div className="my-4 overflow-x-auto rounded-md border border-outline-variant">
              <table
                className={`w-full border-collapse text-body-small text-on-surface ${className}`}
                {...stripNode(props)}
              />
            </div>
          ),
          thead: ({ className = "", ...props }) => (
            <thead className={`bg-surface-container text-on-surface ${className}`} {...stripNode(props)} />
          ),
          tbody: ({ className = "", ...props }) => (
            <tbody
              className={`divide-y divide-outline-variant bg-surface-container-lowest ${className}`}
              {...stripNode(props)}
            />
          ),
          tr: ({ className = "", ...props }) => (
            <tr
              className={`transition-colors hover:bg-surface-container-low ${className}`}
              {...stripNode(props)}
            />
          ),
          th: ({ className = "", align, style, ...props }) => (
            <th
              className={`border-b border-r border-outline-variant px-3 py-2 font-semibold last:border-r-0 ${cellAlignClass(align, style?.textAlign)} ${className}`}
              {...stripNode(props)}
            />
          ),
          td: ({ className = "", align, style, ...props }) => (
            <td
              className={`border-b border-r border-outline-variant px-3 py-2 last:border-r-0 ${cellAlignClass(align, style?.textAlign)} ${className}`}
              {...stripNode(props)}
            />
          ),
          a: ({ href, children: linkChildren, className = "", ...props }) => {
            const isAnchor = typeof href === "string" && href.startsWith("#");
            return (
              <a
                href={href}
                className={`font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary ${className}`}
                {...(href && !isAnchor ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                {...stripNode(props)}
              >
                {linkChildren}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
