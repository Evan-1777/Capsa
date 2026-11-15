import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

/**
 * 记忆正文可能来自任意 Agent，渲染管线按不可信内容处理：
 * skipHtml 关闭内联 HTML，rehype-sanitize 用默认 GitHub 白名单过滤标签、
 * 事件属性与 javascript:/data: 伪协议。协议白名单交给该规则集，不手写黑名单。
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-3 text-body-large text-on-surface">
      <ReactMarkdown
        skipHtml
        rehypePlugins={[rehypeSanitize]}
        components={{
          h1: (props) => <h1 className="mt-5 text-headline-small text-on-surface" {...props} />,
          h2: (props) => <h2 className="mt-5 text-title-large text-on-surface" {...props} />,
          h3: (props) => <h3 className="mt-4 text-title-medium text-on-surface" {...props} />,
          p: (props) => <p className="text-body-large text-on-surface" {...props} />,
          ul: (props) => <ul className="list-disc space-y-1 pl-5 text-body-large" {...props} />,
          ol: (props) => <ol className="list-decimal space-y-1 pl-5 text-body-large" {...props} />,
          blockquote: (props) => (
            <blockquote
              className="border-l-2 border-primary pl-3 text-on-surface-variant"
              {...props}
            />
          ),
          code: (props) => (
            <code
              className="rounded-xs border border-outline-variant bg-surface-container px-1 py-0.5 font-mono text-body-small text-on-surface"
              {...props}
            />
          ),
          pre: (props) => (
            <pre
              className="overflow-x-auto rounded-md border border-outline-variant bg-surface-container p-3 font-mono text-body-small text-on-surface"
              {...props}
            />
          ),
          table: (props) => (
            <table className="w-full border-collapse text-body-small text-on-surface" {...props} />
          ),
          th: (props) => (
            <th
              className="border border-outline-variant bg-surface-container px-2 py-1 text-left font-semibold"
              {...props}
            />
          ),
          td: (props) => (
            <td className="border border-outline-variant px-2 py-1" {...props} />
          ),
          a: ({ children, ...props }) => (
            <a
              className="text-primary underline-offset-2 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            >
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
