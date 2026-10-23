import mongoose, { Schema, Document } from 'mongoose';

export interface IRepository extends Document {
  userId: string;
  name: string;
  owner: string;
  fullName: string;
  source: 'github' | 'zip';
  githubUrl?: string;
  description?: string;
  defaultBranch?: string;
  primaryLanguage: string;
  fileCount: number;
  analysisStatus: 'pending' | 'analyzing' | 'completed' | 'failed';
  statusMessage?: string;
  /** current pipeline stage while analysing (downloading | extracting | analyzing | saving) */
  analysisStage?: string;
  /** commit (GitHub) or content hash (ZIP) of the latest *completed* analysis */
  commitSha?: string;
  /** the newest completed analysis; a later failed run never hides it */
  latestAnalysisId?: mongoose.Types.ObjectId;
  lastAnalyzedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RepositorySchema = new Schema<IRepository>(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    owner: { type: String, required: true },
    fullName: { type: String, required: true },
    source: { type: String, enum: ['github', 'zip'], required: true },
    githubUrl: { type: String },
    description: { type: String, default: '' },
    defaultBranch: { type: String, default: 'main' },
    primaryLanguage: { type: String, default: 'Unknown' },
    fileCount: { type: Number, default: 0 },
    analysisStatus: {
      type: String,
      enum: ['pending', 'analyzing', 'completed', 'failed'],
      default: 'pending',
    },
    statusMessage: { type: String, default: '' },
    analysisStage: { type: String, default: '' },
    commitSha: { type: String },
    latestAnalysisId: { type: Schema.Types.ObjectId, ref: 'Analysis' },
    lastAnalyzedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Unique repository identification per user
RepositorySchema.index({ userId: 1, fullName: 1 }, { unique: true });
RepositorySchema.index({ userId: 1, lastAnalyzedAt: -1 });

export const Repository = mongoose.model<IRepository>('Repository', RepositorySchema);
