import { Client } from 'pg';
import * as dotenv from 'dotenv';
import { getEmbedding } from './embeddings';
import type { BrandProfile, RankedCreator, Creator } from './types';

dotenv.config();

/**
 * Executes a semantic search and returns the top 50 candidates.
 * Calculates cosine similarity as semantic_score.
 */
async function retrieveTop50Candidates(dbUrl: string, queryEmbedding: number[]): Promise<any[]> {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  const embeddingStr = `[${queryEmbedding.join(',')}]`;

  // Explicit instruction: return ONLY the Top 50 creators based on semantic similarity.
  // Using 1 - (embedding <=> $1) for cosine similarity so 1 is identical and 0 is opposite.
  const res = await client.query(`
    SELECT
      username,
      bio,
      content_style_tags,
      projected_score,
      metrics,
      (1 - (embedding <=> $1)) AS semantic_score
    FROM creators
    ORDER BY embedding <=> $1
    LIMIT 50;
  `, [embeddingStr]);

  await client.end();
  return res.rows;
}

/**
 * Computes hybrid final_score: (Semantic x A) + (Projected x B)
 * Business Layer: Hard constraint "Zero Tradeoff" Law 
 */
function computeHybridScore(
  semantic_score: number, 
  projected_score: number, 
  metrics: any
): number {
  // We divide projected by 100 to normalize it to a 0-1 scale so it can be combined cleanly.
  const projNormalized = projected_score / 100.0;
  
  // Starting weights recommended by the hackathon platform
  const SEMANTIC_WEIGHT = 0.45;
  let PROJECTED_WEIGHT = 0.55;

  // Enforce zero tradeoff constraint: High vibe but zero GMV MUST sink lower than good vibe w/ high GMV.
  // We penalty the creator heavily if they drove exactly 0 total_gmv_30d.
  if (metrics && metrics.total_gmv_30d === 0) {
    // If GMV is zero, we severely cripple the projected score's impact or penalize the semantic score
    return (semantic_score * 0.1) + (projNormalized * 0.1); 
  }

  return (semantic_score * SEMANTIC_WEIGHT) + (projNormalized * PROJECTED_WEIGHT);
}

/**
 * Search and rank creators for a given natural-language query and brand profile.
 */
export async function searchCreators(
  query: string,
  brandProfile: BrandProfile
): Promise<RankedCreator[]> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL is not configured.');

  // Step 1: Retrieval (AI Layer)
  // Embed the natural language query
  const queryVector = await getEmbedding(query);

  // Perform vector search specifically against the creators' bio and content_style_tags. Return Top 50.
  const top50Rows = await retrieveTop50Candidates(dbUrl, queryVector);

  const ranked: RankedCreator[] = [];

  for (const row of top50Rows) {
    // Reconstruct TypeScript Creator Object
    const creator: Creator = {
      username: row.username,
      bio: row.bio,
      content_style_tags: row.content_style_tags,
      projected_score: parseFloat(row.projected_score),
      metrics: row.metrics
    };

    const parsedSemanticScore = parseFloat(row.semantic_score);

    // Step 2: Projected Score (Business Layer)
    // Extracted directly from dataset.

    // Step 3: Hybrid Re-ranking (Final Output)
    const final_score = computeHybridScore(parsedSemanticScore, creator.projected_score, creator.metrics);

    ranked.push({
      ...creator,
      scores: {
        semantic_score: parsedSemanticScore,
        projected_score: creator.projected_score, // keep 60-100 scale in final output
        final_score
      }
    });
  }

  // Ensure strict descending order based on the new final hybrid score
  ranked.sort((a, b) => b.scores.final_score - a.scores.final_score);

  // Output formatting requires top 10 ranked creators in the final JSON array
  return ranked.slice(0, 10);
}
