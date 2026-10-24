import React from 'react';
import {
  FileCode2,
  FileText,
  FileJson,
  Coffee,
  Braces,
  Hash,
  Terminal,
  Settings,
  Lock,
  Image as ImageIcon,
  Database,
  FileSpreadsheet,
  File,
} from 'lucide-react';

interface FileIconProps {
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function FileIcon({ name, size = 16, style, className }: FileIconProps) {
  const ext = name.toLowerCase().split('.').pop() || '';
  const lowerName = name.toLowerCase();

  // Special files
  if (lowerName === 'package.json' || lowerName.endsWith('config.json')) {
    return <Settings size={size} color="#60A5FA" style={style} className={className} />;
  }
  if (lowerName.includes('lock') || lowerName.endsWith('.lockb')) {
    return <Lock size={size} color="#FBBF24" style={style} className={className} />;
  }

  // Extensions
  switch (ext) {
    case 'tsx':
    case 'jsx':
      // React Component file icon
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#38BDF8"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={style}
          className={className}
          aria-hidden="true"
        >
          <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(30 12 12)" />
          <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(90 12 12)" />
          <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(150 12 12)" />
          <circle cx="12" cy="12" r="1.5" fill="#38BDF8" />
        </svg>
      );
    case 'ts':
    case 'mts':
    case 'cts':
      return <FileCode2 size={size} color="#386BFF" style={style} className={className} />;
    case 'js':
    case 'mjs':
    case 'cjs':
      return <FileCode2 size={size} color="#FFB054" style={style} className={className} />;
    case 'java':
      return <Coffee size={size} color="#FF717A" style={style} className={className} />;
    case 'py':
      return <Terminal size={size} color="#43D9A3" style={style} className={className} />;
    case 'go':
      return <Terminal size={size} color="#37D9FF" style={style} className={className} />;
    case 'json':
    case 'jsonc':
      return <Braces size={size} color="#FCD34D" style={style} className={className} />;
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return <Hash size={size} color="#C084FC" style={style} className={className} />;
    case 'html':
    case 'htm':
      return <FileCode2 size={size} color="#F97316" style={style} className={className} />;
    case 'md':
    case 'mdx':
      return <FileText size={size} color="#37D9FF" style={style} className={className} />;
    case 'sql':
      return <Database size={size} color="#F472B6" style={style} className={className} />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'svg':
    case 'webp':
    case 'gif':
      return <ImageIcon size={size} color="#A78BFA" style={style} className={className} />;
    case 'csv':
    case 'tsv':
      return <FileSpreadsheet size={size} color="#34D399" style={style} className={className} />;
    default:
      return <FileText size={size} color="#A7B4CC" style={style} className={className} />;
  }
}
