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
   * Detect city name from query
   */
  private detectCityFromQuery(query: string): string | null {
    const lowerQuery = query.toLowerCase();
    const cities: { [key: string]: string[] } = {
      'krakow': ['krakow', 'kraków', 'krakowie', 'krakowskie'],
      'warsaw': ['warsaw', 'warszawa', 'warszawie', 'warszawskie'],
      'gdansk': ['gdansk', 'gdańsk', 'gdańsku'],
      'wroclaw': ['wroclaw', 'wrocław', 'wrocławiu'],
      'poznan': ['poznan', 'poznań', 'poznaniu'],
    };
    
    for (const [city, variants] of Object.entries(cities)) {
      if (variants.some(v => lowerQuery.includes(v))) {
        return city;
      }
    }
    return null;
  }
  
  /**
   * Fetch tours by city when semantic search fails
   */
  private async fetchToursByCity(cityName: string): Promise<KnowledgeChunk[]> {
    try {
      // Get all documents of type 'tour' that mention this city
      const { data: documents, error } = await supabase
        .schema('semantic')
        .from('semantic_documents')
        .select('id, canonical_title, canonical_description, canonical_summary')
        .eq('entity_type', 'tour')
        .or(`canonical_title.ilike.%${cityName}%,canonical_description.ilike.%${cityName}%,canonical_summary.ilike.%${cityName}%`)
        .limit(10);
      
      if (error || !documents || documents.length === 0) {
        console.log('No tours found for city:', cityName);
        return [];
      }
      
      console.log('Fetched', documents.length, 'tours for city:', cityName);
      
      return documents.map(doc => ({
        source: `[TOUR] ${doc.canonical_title} (City Match)`,
        content: `Title: ${doc.canonical_title}\n\nSummary: ${doc.canonical_summary || doc.canonical_description || 'No description available'}`,
        metadata: {
          document_id: doc.id,
          entity_type: 'tour',
          doc_title: doc.canonical_title
        }
      }));
    } catch (error) {
      console.error('Error fetching tours by city:', error);
      return [];
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
      
      // Step 2: Perform vector similarity search with higher count for diversity
      const { data: results, error } = await supabase
        .schema('semantic')
        .rpc('match_chunks', {
          query_embedding: queryEmbedding,
          match_threshold: 0.4,
          match_count: 50 // Higher count to catch more diverse tours
        });
      
      if (error) {
        console.error('RPC match_chunks error:', error);
        return await this.searchWithDirectQuery(queryEmbedding);
      }
      
      if (!results || results.length === 0) {
        console.log('No results from vector search');
        
        // Fallback: if query asks for tours in a city, fetch directly
        const city = this.detectCityFromQuery(query);
        const isTourListQuery = /list|wszystk|wycieczk|tour|mamy|oferuj/i.test(query);
        if (city && isTourListQuery) {
          console.log('Using city-based fallback for:', city);
          return await this.fetchToursByCity(city);
        }
        
        return [];
      }
      
      console.log('Found', results.length, 'semantic matches');
      console.log('Top similarity:', results[0]?.similarity);
      
      // Step 3: Deduplicate and diversify results
      // Group by document_id and take max 2 chunks per document
      const byDocument = new Map<string, any[]>();
      
      for (const result of results) {
        const docId = result.document_id;
        if (!byDocument.has(docId)) {
          byDocument.set(docId, []);
        }
        const docChunks = byDocument.get(docId)!;
        if (docChunks.length < 2) { // Max 2 chunks per document
          docChunks.push(result);
        }
      }
      
      // Flatten and prioritize TOUR entities for product queries
      const isProductQuery = /wycieczk|tour|trip|visit|booking|book|list|wszystk|oferuj/i.test(query);
      const diverseResults = Array.from(byDocument.values())
        .flat()
        .sort((a, b) => {
          // Prioritize TOUR if product query
          if (isProductQuery) {
            if (a.entity_type === 'tour' && b.entity_type !== 'tour') return -1;
            if (a.entity_type !== 'tour' && b.entity_type === 'tour') return 1;
          }
          // Then sort by similarity
          return b.similarity - a.similarity;
        })
        .slice(0, 10); // Take top 10 diverse results
      
      console.log('Unique documents:', byDocument.size);
      console.log('TOUR entities:', diverseResults.filter((r: any) => r.entity_type === 'tour').length);
      
      // Fallback: If no TOUR entities found but query asks for tours, fetch by city
      const tourCount = diverseResults.filter((r: any) => r.entity_type === 'tour').length;
      if (tourCount === 0 && isProductQuery) {
        const city = this.detectCityFromQuery(query);
        if (city) {
          console.log('No TOUR entities in semantic results. Using city-based fallback for:', city);
          const cityTours = await this.fetchToursByCity(city);
          if (cityTours.length > 0) {
            return cityTours;
          }
        }
      }
      
      // Step 4: Format results
      return diverseResults.map((result: any) => {
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
