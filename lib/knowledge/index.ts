import { supabase } from '../db/supabase';
import { GoogleGenerativeAI } from '@google/generative-ai';

export type KnowledgeChunk = {
  source: string;
  content: string;
  metadata?: any;
};

export interface KnowledgeSource {
  search(query: string): Promise<KnowledgeChunk[]>;
}

// Initialize Google Generative AI
// Note: Requires GOOGLE_API_KEY in .env.local
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');
const model = genAI.getGenerativeModel({ model: "text-embedding-004" });

export class SupabaseKnowledgeSource implements KnowledgeSource {
  
  /**
   * Generate embedding for a query using Google Gemini
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      if (!process.env.GOOGLE_API_KEY) {
        throw new Error('GOOGLE_API_KEY is missing in environment variables');
      }

      const result = await model.embedContent(text);
      const embedding = result.embedding;
      return embedding.values;
    } catch (error) {
      console.error('Error generating embedding with Gemini:', error);
      throw error;
    }
  }
  
  /**
   * Search for relevant content using vector similarity
   */
  async search(query: string): Promise<KnowledgeChunk[]> {
    try {
      console.log('=== Supabase Semantic Search (Gemini) ===');
      console.log('Query:', query);
      
      // Step 1: Generate embedding for the query
      const queryEmbedding = await this.generateEmbedding(query);
      console.log('Generated embedding, dimension:', queryEmbedding.length);
      
      // Step 2: Perform vector similarity search
      const { data: results, error } = await supabase
        .schema('semantic')
        .rpc('match_chunks', {
          query_embedding: queryEmbedding,
          match_threshold: 0.4, // Higher threshold for correct model
          match_count: 5
        });
      
      if (error) {
        console.error('RPC match_chunks error:', error);
        return await this.searchWithDirectQuery(queryEmbedding);
      }
      
      if (!results || results.length === 0) {
        console.log('No results from vector search');
        return [];
      }
      
      console.log('Found', results.length, 'semantic matches');
      console.log('Top similarity:', results[0]?.similarity);
      
      // Step 3: Format results
      return results.map((result: any) => {
        // Format source based on entity type
        const typeLabel = result.entity_type ? `[${result.entity_type.toUpperCase()}]` : '[UNKNOWN]';
        const title = result.doc_title || 'Untitled';
        
        return {
          source: `${typeLabel} ${title} (${(result.similarity * 100).toFixed(1)}%)`,
          content: result.text || result.content,
          metadata: {
            similarity: result.similarity,
            chunk_id: result.chunk_id || result.id,
            document_id: result.document_id,
            entity_type: result.entity_type,
            doc_title: result.doc_title,
            ...result.metadata
          }
        };
      });
      
    } catch (error) {
      console.error('Error in semantic search:', error);
      return [];
    }
  }
  
  /**
   * Fallback: Direct query if RPC function doesn't exist
   */
  private async searchWithDirectQuery(queryEmbedding: number[]): Promise<KnowledgeChunk[]> {
    console.log('Trying direct query fallback...');
    
    try {
      // Query semantic_embeddings and join with semantic_chunks
      const { data: embeddings, error: embError } = await supabase
        .schema('semantic')
        .from('semantic_embeddings')
        .select(`
          id,
          chunk_id,
          embedding,
          semantic_chunks!inner (
            id,
            text,
            metadata,
            document_id
          )
        `)
        .limit(100); // Get top 100 for client-side similarity calc
      
      if (embError || !embeddings) {
        console.error('Direct query error:', embError);
        return [];
      }
      
      // Calculate cosine similarity on client side
      const withSimilarity = embeddings.map((item: any) => {
        const similarity = this.cosineSimilarity(
          queryEmbedding,
          item.embedding
        );
        
        return {
          similarity,
          text: item.semantic_chunks.text,
          chunk_id: item.chunk_id,
          document_id: item.semantic_chunks.document_id,
          metadata: item.semantic_chunks.metadata
        };
      });
      
      // Sort by similarity and take top 5
      const topMatches = withSimilarity
        .filter(item => item.similarity > 0.4)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 5);
      
      console.log('Direct query found', topMatches.length, 'matches');
      
      return topMatches.map(match => ({
        source: `Semantic Match (${(match.similarity * 100).toFixed(1)}%)`,
        content: match.text,
        metadata: {
          similarity: match.similarity,
          chunk_id: match.chunk_id,
          document_id: match.document_id,
          ...match.metadata
        }
      }));
      
    } catch (error) {
      console.error('Direct query fallback error:', error);
      return [];
    }
  }
  
  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
