import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import * as dotenv from 'dotenv';
import { getEmbedding } from '../src/embeddings';
import type { Creator } from '../src/types';

dotenv.config();

/**
 * Script to read creators.json, generate embeddings for each creator's
 * bio + content_style_tags, and store them in the PostgreSQL database with pgvector.
 */
async function ingest() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL environment variable is missing.');
  }

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  console.log('Connected to the database. Ensuring pgvector extension exists...');
  await client.query('CREATE EXTENSION IF NOT EXISTS vector;');

  console.log('Creating creators table with vector column...');
  await client.query(`
    DROP TABLE IF EXISTS creators;
    CREATE TABLE creators (
      id SERIAL PRIMARY KEY,
      username VARCHAR UNIQUE NOT NULL,
      bio TEXT,
      content_style_tags JSONB,
      projected_score NUMERIC,
      metrics JSONB,
      embedding vector(384) -- Xenova/all-MiniLM-L6-v2 produces 384-d vectors
    );
  `);

  const filePath = path.join(__dirname, '..', 'creators.json');
  console.log(`Reading dataset from ${filePath}...`);
  const data = fs.readFileSync(filePath, 'utf-8');
  let creators: Creator[];
  try {
    creators = JSON.parse(data);
  } catch (err) {
    console.error('Error parsing creators.json. Check file format.', err);
    process.exit(1);
  }

  console.log(`Found ${creators.length} creators. Starting ingestion...`);

  let count = 0;
  for (const creator of creators) {
    // Strategic context: Combine bio and content_style_tags to ensure maximum semantic capture
    const semanticText = `${creator.bio} ${creator.content_style_tags.join(' ')}`;
    
    // 1. Generate local vector embedding
    const embeddingArray = await getEmbedding(semanticText);
    const embeddingStr = `[${embeddingArray.join(',')}]`;

    // 2. Insert record into Postgres
    await client.query(
      `INSERT INTO creators 
        (username, bio, content_style_tags, projected_score, metrics, embedding) 
      VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        creator.username,
        creator.bio,
        JSON.stringify(creator.content_style_tags),
        creator.projected_score,
        JSON.stringify(creator.metrics),
        embeddingStr
      ]
    );
    count++;
    if (count % 20 === 0) {
      console.log(`Ingested ${count} / ${creators.length} creators...`);
    }
  }

  console.log('✅ Ingestion complete!');
  await client.end();
}

ingest().catch((err) => {
  console.error('Failed to ingest creators:', err);
  process.exit(1);
});
