import { typeGroup, type AtlasFilters } from './atlasStore';
import type { AtlasModel, Edge, FileNode } from './model';

/**
 * Is a file shown at full strength under the current filters? (Filtered-out files are dimmed, never removed.)
 * `findings` is only needed for the "files with findings" filter.
 */
export function filePassesFilters(file: FileNode, f: AtlasFilters, model: AtlasModel, findings?: ReadonlyMap<string, unknown[]>): boolean {
  if (f.hiddenTypes.size && f.hiddenTypes.has(typeGroup(file.ext))) return false;
  if (f.hiddenFolders.size) {
    const top = model.folderByPath.get(file.folder)?.top ?? '';
    if (f.hiddenFolders.has(top)) return false;
  }
  if (f.cyclesOnly && !model.cycleOf.has(file.path)) return false;
  if (f.findingsOnly && !(findings?.get(file.path)?.length)) return false;
  return true;
}

/**
 * Is a resolved edge drawn? Its kind must be enabled and both ends must pass the folder/type filters.
 * (With "cycles only", only cycle edges; the findings filter only affects files.)
 */
export function edgePassesFilters(e: Edge, f: AtlasFilters, model: AtlasModel): boolean {
  if (e.status !== 'resolved' || !e.to) return false;
  if (f.hiddenKinds.has(e.kind)) return false;
  if (f.cyclesOnly && !model.cycleEdges.has(e)) return false;
  const from = model.fileByPath.get(e.from);
  const to = model.fileByPath.get(e.to);
  if (!from || !to) return false;
  const fileFilters = { ...f, cyclesOnly: false, findingsOnly: false };
  return filePassesFilters(from, fileFilters, model) && filePassesFilters(to, fileFilters, model);
}
