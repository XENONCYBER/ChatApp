import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import Mark from 'mark.js';
import 'prismjs/themes/prism-tomorrow.css';
// Prism languages are side-effect imports that register into Prism.languages.
// Imported in dependency order (clike -> markup/css -> the rest).
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-diff';
import { Copy, Check, User, Bot } from 'lucide-react';
import type { ChatMessage, Bookmark } from '../types/chat';

interface MessageBubbleProps {
  message: ChatMessage;
  siteName: string;
  msgIndex: number;
  bookmarks?: Bookmark[];
}

/** Recover the raw text of a code node from the mdast position info. */
function nodeToText(children: React.ReactNode): string {
  if (children == null || typeof children === 'boolean') return '';
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(nodeToText).join('');
  if (React.isValidElement(children)) {
    return nodeToText((children.props as { children?: React.ReactNode }).children);
  }
  return '';
}

export function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** Normalize common language aliases to Prism's canonical names. */
const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  py3: 'python',
  sh: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  html: 'markup',
  xml: 'markup',
  htm: 'markup',
  'c++': 'cpp',
  'cpp': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  'css': 'css',
  'text': '',
  'txt': '',
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Highlight `code` with Prism; falls back to escaped plain text. */
function highlightCode(code: string, language: string): { html: string; className: string } {
  const normalized = LANG_ALIASES[language.toLowerCase()] ?? language.toLowerCase();
  const grammar = normalized ? Prism.languages[normalized] : undefined;
  if (grammar) {
    try {
      return {
        html: Prism.highlight(code, grammar, normalized),
        className: `language-${normalized}`,
      };
    } catch {
      /* malformed grammar – fall through to plain text */
    }
  }
  return { html: escapeHtml(code), className: '' };
}

// Stable references so react-markdown's internal memoization survives
// unrelated App re-renders (sidebar filter/collapse, the 5s poll).
const remarkPlugins = [remarkGfm];

const markdownComponents = {
  table({ node: _node, children, ...props }: any) {
    return (
      <div className="table-wrapper" role="region" aria-label="Table" tabIndex={0}>
        <table {...props}>{children}</table>
      </div>
    );
  },

  pre({ children }: any) {
    return <>{children}</>;
  },

  code({ node, className, children, ...props }: any) {
    const match = /language-([\w+#-]+)/.exec(className || '');
    const isBlock =
      node?.type === 'code' ||
      (node?.tagName === 'code' &&
        node?.position?.start?.line !== node?.position?.end?.line) ||
      Boolean(match);

    if (isBlock) {
      return (
        <CodeBlock
          language={match ? match[1] : ''}
          code={nodeToText(children).replace(/\n$/, '')}
        />
      );
    }

    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },

  a({ node: _node, children, href, ...props }: any) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  },
};

function MessageBubbleBase({ message, siteName, msgIndex, bookmarks }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const roleTitle = isUser ? 'You' : siteName || 'Assistant';
  const containerRef = useRef<HTMLDivElement>(null);

  // Inject IDs to headings for the Table of Contents
  const componentsWithHeadings = useMemo(() => {
    const createHeading = (Tag: 'h1' | 'h2' | 'h3') => ({ children, ...props }: any) => {
      const text = nodeToText(children);
      const id = `${slugify(text)}-${msgIndex}`;
      return <Tag id={id} {...props}>{children}</Tag>;
    };

    return {
      ...markdownComponents,
      h1: createHeading('h1'),
      h2: createHeading('h2'),
      h3: createHeading('h3'),
    };
  }, [msgIndex]);

  // Use mark.js to visually highlight bookmarked text
  useEffect(() => {
    if (!containerRef.current) return;
    const marker = new Mark(containerRef.current);
    
    // Clear old marks
    marker.unmark();

    if (bookmarks && bookmarks.length > 0) {
      bookmarks.forEach(bm => {
        if (!bm.text) return;
        // mark.js finds text across elements (e.g. if part is bold)
        marker.mark(bm.text, {
          className: 'bookmarked-text',
          acrossElements: true,
          separateWordSearch: false,
        });
      });
    }

    return () => {
      marker.unmark();
    };
  }, [bookmarks, message.content]);

  return (
    <div className={`message-block ${message.role}`} ref={containerRef}>
      <div className="message-header">
        {isUser ? <User size={14} /> : <Bot size={14} />}
        <span>{roleTitle}</span>
      </div>

      <div className="message-body">
        <ReactMarkdown remarkPlugins={remarkPlugins} components={componentsWithHeadings}>
          {message.content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

// Compare by value, not reference
export const MessageBubble = React.memo(MessageBubbleBase, (prev, next) =>
  prev.message.content === next.message.content &&
  prev.message.role === next.message.role &&
  prev.siteName === next.siteName &&
  prev.msgIndex === next.msgIndex &&
  JSON.stringify(prev.bookmarks) === JSON.stringify(next.bookmarks)
);

interface CodeBlockProps {
  language: string;
  code: string;
}

function CodeBlockBase({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const { html, className } = useMemo(() => highlightCode(code, language), [code, language]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.warn('Clipboard write failed');
    }
  }, [code]);

  return (
    <pre>
      <div className="code-header">
        <span>{language || 'code'}</span>
        <button className="copy-btn" onClick={handleCopy} type="button">
          {copied ? <Check size={13} /> : <Copy size={13} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <code
        className={className}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </pre>
  );
}

const CodeBlock = React.memo(CodeBlockBase);
