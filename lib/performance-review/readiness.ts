import { MIN_POSTS_FOR_REVIEW } from "./limits";

// Whether a period has enough posts with numbers for a performance review
// (step 42), in the words the Analytics page and the service both use. Pure.

// How many more posts with numbers a review of the period needs (0: none).
export function postsStillNeeded(postsWithNumbers: number): number {
  return Math.max(0, MIN_POSTS_FOR_REVIEW - postsWithNumbers);
}

// "A review needs at least 5 posts with numbers in the period, and it has 3: 2 more are needed."
export function describePostsStillNeeded(postsWithNumbers: number): string {
  const needed = postsStillNeeded(postsWithNumbers);
  return `A review needs at least ${MIN_POSTS_FOR_REVIEW} posts with numbers in the period, and it has ${postsWithNumbers}: ${needed} more ${needed === 1 ? "is" : "are"} needed.`;
}
