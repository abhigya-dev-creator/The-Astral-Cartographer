import type { ExplorerFileItem } from './explorerTypes';

export interface TreeNode {
  id: string; // full path
  name: string; // basename
  path: string;
  isFolder: boolean;
  children: TreeNode[];
  fileItem?: ExplorerFileItem;
  filesCount: number;
}

// Preset folder colors inspired by cosmic dark themes and the reference image
const FOLDER_COLORS: Record<string, string> = {
  app: '#FFB054', // amber / orange
  src: '#8B78FF', // violet
  components: '#C084FC', // purple
  ui: '#A855F7', // vivid purple
  layout: '#A855F7',
  hooks: '#37D9FF', // cyan
  lib: '#38BDF8', // sky blue
  utils: '#43D9A3', // mint green
  helpers: '#43D9A3',
  pages: '#F472B6', // pink
  views: '#F472B6',
  assets: '#FCD34D', // yellow
  styles: '#818CF8', // indigo
  css: '#818CF8',
  config: '#60A5FA', // blue
  public: '#FBBF24', // amber
  api: '#34D399', // emerald
  routes: '#34D399',
  server: '#386BFF', // deep blue
  client: '#8755FF', // purple
  models: '#F87171', // red/coral
  services: '#38BDF8',
  tests: '#A78BFA',
  test: '#A78BFA',
};

const PALETTE = [
  '#FFB054', // amber
  '#C084FC', // purple
  '#37D9FF', // cyan
  '#43D9A3', // green
  '#F472B6', // pink
  '#60A5FA', // blue
  '#818CF8', // indigo
  '#FCD34D', // yellow
];

/** Return consistent folder color based on folder name or hash */
export function getFolderColor(folderName: string): string {
  const lower = folderName.toLowerCase();
  if (FOLDER_COLORS[lower]) return FOLDER_COLORS[lower];

  // Hash-based deterministic color selection
  let hash = 0;
  for (let i = 0; i < lower.length; i++) {
    hash = (hash << 5) - hash + lower.charCodeAt(i);
    hash |= 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

/** Builds hierarchical tree from a flat list of explorer files */
export function buildFileTree(files: ExplorerFileItem[]): TreeNode {
  const root: TreeNode = {
    id: '',
    name: 'root',
    path: '',
    isFolder: true,
    children: [],
    filesCount: files.length,
  };

  const folderMap = new Map<string, TreeNode>();
  folderMap.set('', root);

  const getOrCreateFolder = (folderPath: string): TreeNode => {
    if (folderMap.has(folderPath)) return folderMap.get(folderPath)!;

    const parts = folderPath.split('/');
    const name = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join('/');
    const parent = getOrCreateFolder(parentPath);

    const folderNode: TreeNode = {
      id: folderPath,
      name,
      path: folderPath,
      isFolder: true,
      children: [],
      filesCount: 0,
    };

    parent.children.push(folderNode);
    folderMap.set(folderPath, folderNode);
    return folderNode;
  };

  for (const file of files) {
    const parent = getOrCreateFolder(file.folder);
    parent.children.push({
      id: file.path,
      name: file.name,
      path: file.path,
      isFolder: false,
      children: [],
      fileItem: file,
      filesCount: 1,
    });

    // Update ancestor files count
    let curr = file.folder;
    while (curr) {
      const f = folderMap.get(curr);
      if (f) f.filesCount++;
      const idx = curr.lastIndexOf('/');
      curr = idx >= 0 ? curr.slice(0, idx) : '';
    }
  }

  // Sort children: folders first, then files alphabetically
  const sortNode = (node: TreeNode) => {
    node.children.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    for (const child of node.children) {
      if (child.isFolder) sortNode(child);
    }
  };

  sortNode(root);
  return root;
}

/** Flatten visible nodes based on expanded folder set */
export function flattenVisibleTree(
  node: TreeNode,
  expanded: Set<string>,
  depth = 0
): Array<{ node: TreeNode; depth: number }> {
  const list: Array<{ node: TreeNode; depth: number }> = [];

  for (const child of node.children) {
    list.push({ node: child, depth });
    if (child.isFolder && expanded.has(child.path)) {
      list.push(...flattenVisibleTree(child, expanded, depth + 1));
    }
  }

  return list;
}

/** Filter tree nodes based on query */
export function filterTree(
  node: TreeNode,
  query: string
): TreeNode | null {
  const q = query.trim().toLowerCase();
  if (!q) return node;

  const matchesSelf = node.name.toLowerCase().includes(q) || node.path.toLowerCase().includes(q);

  if (!node.isFolder) {
    return matchesSelf ? node : null;
  }

  const matchingChildren: TreeNode[] = [];
  for (const child of node.children) {
    const matched = filterTree(child, q);
    if (matched) matchingChildren.push(matched);
  }

  if (matchesSelf || matchingChildren.length > 0) {
    return {
      ...node,
      children: matchingChildren,
    };
  }

  return null;
}

/** Get all ancestor folder paths for a file/folder to auto-expand */
export function getAncestorPaths(filePath: string): string[] {
  const parts = filePath.split('/');
  const paths: string[] = [''];
  let current = '';

  for (let i = 0; i < parts.length - 1; i++) {
    current = current ? `${current}/${parts[i]}` : parts[i];
    paths.push(current);
  }

  return paths;
}
