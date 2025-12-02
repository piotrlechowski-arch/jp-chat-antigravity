import { doQuery } from '../db/digitalocean';

export interface KnowledgeChunk {
  source: string;
  content: string;
  metadata?: any;
}

export interface KnowledgeSource {
  search(query: string): Promise<KnowledgeChunk[]>;
}

export class DoPostgresKnowledgeSource implements KnowledgeSource {
  async search(query: string): Promise<KnowledgeChunk[]> {
    try {
      // First, try to use the RAG unified documents table (already has embeddings and unified text)
      const ragSql = `
        SELECT 
          id,
          source_table,
          source_record_id,
          unified_text,
          primary_language,
          metadata
        FROM main.rag_unified_documents
        WHERE unified_text ILIKE $1
        LIMIT 10;
      `;
      
      let result = await doQuery(ragSql, [`%${query}%`]);
      
      if (result.rows.length > 0) {
        return result.rows.map((row: any) => ({
          source: `DO - ${row.source_table} (${row.primary_language})`,
          content: row.unified_text.substring(0, 1000), // Limit content length
          metadata: {
            id: row.id,
            source_table: row.source_table,
            source_record_id: row.source_record_id,
            language: row.primary_language,
            ...row.metadata
          }
        }));
      }
      
      // Fallback: search products directly if RAG doesn't return results
      const productSql = `
        SELECT 
          id,
          title_en,
          title,
          short_description_en,
          short_description,
          long_description_en,
          long_description,
          city_id,
          slug_en,
          slug
        FROM main.products_product
        WHERE 
          title_en ILIKE $1 OR
          title ILIKE $1 OR
          short_description_en ILIKE $1 OR
          short_description ILIKE $1 OR
          long_description_en ILIKE $1 OR
          long_description ILIKE $1
        LIMIT 5;
      `;
      
      result = await doQuery(productSql, [`%${query}%`]);
      
      return result.rows.map((row: any) => ({
        source: `DO - Product: ${row.title_en || row.title}`,
        content: `Title: ${row.title_en || row.title}\n\n${row.short_description_en || row.short_description || ''}\n\n${(row.long_description_en || row.long_description || '').substring(0, 500)}`,
        metadata: {
          id: row.id,
          slug: row.slug_en || row.slug,
          city_id: row.city_id
        }
      }));
      
    } catch (error) {
      console.error('Error searching DigitalOcean:', error);
      return [];
    }
  }
}
