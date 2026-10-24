import mongoose, { Schema, Document } from 'mongoose';
import type { AtlasMeta } from '../services/atlas/store.js';
import type {
  AnalysisMetrics,
  AnalyzedFile,
  ArchitecturalIssue,
  DependencyEdge,
  IDependencyMetrics,
  ISupportStatus,
  LanguageBreakdownEntry,
} from '../services/analysis/types.js';

export type { IDependencyMetrics, ISupportStatus };
export type IAnalysisMetrics = AnalysisMetrics;
export type IArchitecturalIssue = ArchitecturalIssue;
export type IDependencyEdge = DependencyEdge;
export type IAnalysisFile = AnalyzedFile;

export interface IAnalysis extends Document {
  repositoryId: mongoose.Types.ObjectId;
  userId: string;
  status: 'pending' | 'analyzing' | 'completed' | 'failed';
  errorMessage?: string;
  version?: string;
  /** commit SHA (GitHub) or archive content hash (ZIP) that was analysed */
  commitSha?: string;
  branch?: string;
  analyzerVersion?: string;
  /** set when stored detail had to be reduced to fit MongoDB's 16 MB document limit */
  truncated?: boolean;
  warnings: string[];
  /** Dependency Atlas summary; the AtlasData itself is in GridFS (bucket "atlas", file name = analysis id) */
  atlas?: AtlasMeta | null;
  metrics: IAnalysisMetrics;
  languages: LanguageBreakdownEntry[];
  files: IAnalysisFile[];
  issues: IArchitecturalIssue[];
  dependencyGraph: IDependencyEdge[];
  createdAt: Date;
}

const AnalysisSchema = new Schema<IAnalysis>(
  {
    repositoryId: { type: Schema.Types.ObjectId, ref: 'Repository', required: true, index: true },
    userId: { type: String, required: true, index: true },
    status: { type: String, enum: ['pending', 'analyzing', 'completed', 'failed'], default: 'pending' },
    errorMessage: { type: String },
    version: { type: String, default: '1.0' },
    commitSha: { type: String },
    branch: { type: String },
    analyzerVersion: { type: String },
    truncated: { type: Boolean, default: false },
    warnings: [{ type: String }],
    atlas: { type: Schema.Types.Mixed, default: null },
    metrics: {
      totalFiles: { type: Number, default: 0 },
      // null means "not available" – never a fake 0
      functions: { type: Number, default: null },
      dependencies: { type: Number, default: null },
      architecturalIssues: { type: Number, default: 0 },
      confirmedIssues: { type: Number, default: 0 },
      heuristicIssues: { type: Number, default: 0 },
      totalLines: { type: Number, default: 0 },
      dependencyMetrics: { type: Schema.Types.Mixed, default: null },
      // analyzer-owned structures stored as-is so new fields never get silently dropped by schema strictness
      supportStatus: { type: Schema.Types.Mixed, default: () => ({}) },
      functionKinds: { type: Schema.Types.Mixed, default: null },
      coverage: { type: Schema.Types.Mixed, default: null },
      definitions: { type: Schema.Types.Mixed, default: null },
    },
    languages: [
      {
        _id: false,
        name: { type: String, required: true },
        count: { type: Number, required: true },
        percentage: { type: Number, required: true },
        lines: { type: Number, default: 0 },
        bytes: { type: Number, default: 0 },
        support: { type: String, enum: ['full', 'partial', 'unsupported', 'n/a'], default: 'n/a' },
      },
    ],
    files: [
      {
        _id: false,
        path: { type: String, required: true },
        extension: { type: String, default: '' },
        language: { type: String, default: 'Other' },
        size: { type: Number, default: 0 },
        lineCount: { type: Number, default: 0 },
        functionCount: { type: Number, default: null },
        parseStatus: { type: String, default: 'not_code' },
        dependencies: [{ type: String }],
        resolvedLocalDeps: [{ type: String }],
        unresolvedLocalDeps: [{ type: String }],
        warnings: [{ type: String }],
        isTest: { type: Boolean, default: false },
        isGenerated: { type: Boolean, default: false },
        isDeclaration: { type: Boolean, default: false },
      },
    ],
    issues: [
      {
        _id: false,
        id: { type: String },
        type: { type: String, required: true },
        severity: { type: String, enum: ['error', 'warning', 'info'], default: 'warning' },
        confidence: { type: String, enum: ['confirmed', 'heuristic'], default: 'heuristic' },
        file: { type: String, required: true },
        line: { type: Number },
        affectedFiles: [{ type: String }],
        description: { type: String, required: true },
        rule: { type: String, required: true },
      },
    ],
    dependencyGraph: [
      {
        _id: false,
        source: { type: String, required: true },
        target: { type: String, required: true },
        type: { type: String, enum: ['internal', 'external', 'builtin'], required: true },
        kind: { type: String, enum: ['static', 'reexport', 'dynamic', 'type'], default: 'static' },
        line: { type: Number },
      },
    ],
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

AnalysisSchema.index({ repositoryId: 1, status: 1, createdAt: -1 });

export const Analysis = mongoose.model<IAnalysis>('Analysis', AnalysisSchema);
