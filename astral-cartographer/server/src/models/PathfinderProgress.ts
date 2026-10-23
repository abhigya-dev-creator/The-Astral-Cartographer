import mongoose, { Schema, Document } from 'mongoose';

/** Onboarding Pathfinder state of one user for one repository: learning progress and saved opportunities. */
export interface IPathfinderProgress extends Document {
  userId: string;
  repositoryId: mongoose.Types.ObjectId;
  /** file paths of completed learning steps */
  completed: string[];
  /** file path of the learning step the user is on */
  current: string | null;
  /** ids of saved contribution opportunities */
  saved: string[];
  createdAt: Date;
  updatedAt: Date;
}

const PathfinderProgressSchema = new Schema<IPathfinderProgress>(
  {
    userId: { type: String, required: true },
    repositoryId: { type: Schema.Types.ObjectId, ref: 'Repository', required: true },
    completed: { type: [String], default: [] },
    current: { type: String, default: null },
    saved: { type: [String], default: [] },
  },
  { timestamps: true }
);

PathfinderProgressSchema.index({ userId: 1, repositoryId: 1 }, { unique: true });

export const PathfinderProgress = mongoose.model<IPathfinderProgress>('PathfinderProgress', PathfinderProgressSchema);
