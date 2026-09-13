import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

/**
 * 记忆正文可能来自任意 Agent，渲染管线按不可信内容处理：
 * skipHtml 关闭内联 HTML，rehype-sanitize 用默认 GitHub 白名单过滤标签、
 * 事件属性与 javascript:/data: 伪协议。协议白名单交给该规则集，不手写黑名单。
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-capsa space-y-3 text-[13px] leading-6 text-zinc-800">
      <ReactMarkdown
        skipHtml
        rehypePlugins={[rehypeSanitize]}
        components={{
          h1: (props) => <h1 className="mt-5 text-lg font-semibold" {...props} />,
          h2: (props) => <h2 className="mt-5 text-base font-semibold" {...props} />,
          h3: (props) => <h3 className="mt-4 text-sm font-semibold" {...props} />,
          p: (props) => <p className="text-[13px] leading-6" {...props} />,
          ul: (props) => <ul className="list-disc space-y-1 pl-5" {...props} />,
          ol: (props) => <ol className="list-decimal space-y-1 pl-5" {...props} />,
          blockquote: (props) => (
            <blockquote className="border-l-2 border-zinc-300 pl-3 text-zinc-600" {...props} />
          ),
          code: (props) => (
            <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs" {...props} />
          ),
          pre: (props) => (
            <pre className="overflow-x-auto rounded border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs" {...props} />
          ),
          table: (props) => <table className="w-full border-collapse text-xs" {...props} />,
          th: (props) => <th className="border border-zinc-200 px-2 py-1 text-left" {...props} />,
          td: (props) => <td className="border border-zinc-200 px-2 py-1" {...props} />,
          a: ({ children, ...props }) => (
            <a className="text-blue-700 underline underline-offset-2" target="_blank" rel="noopener noreferrer" {...props}>
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
