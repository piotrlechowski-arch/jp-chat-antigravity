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
      // Search for Products (Tours)
      const productSql = `
        SELECT 
          p.id,
          p.title_en,
          p.title,
          p.short_description_en,
          p.short_description,
          p.long_description_en,
          p.long_description,
          p.slug_en,
          p.slug,
          c.name_en as city_name,
          c.name as city_name_local
        FROM main.products_product p
        LEFT JOIN public.cities_city c ON p.city_id = c.id
        WHERE 
          p.title_en ILIKE $1 OR
          p.title ILIKE $1 OR
          p.short_description_en ILIKE $1 OR
          p.short_description ILIKE $1 OR
          p.long_description_en ILIKE $1 OR
          p.long_description ILIKE $1
        LIMIT 5;
      `;
      
      console.log('Executing Product Search:', productSql.replace(/\s+/g, ' '), 'Params:', [`%${query}%`]);
      const productResult = await doQuery(productSql, [`%${query}%`]);
      console.log('Product Search Results:', productResult.rows.length);
      
      const productChunks = productResult.rows.map((row: any) => ({
        source: `DO - Product: ${row.title_en || row.title}`,
        content: `Title: ${row.title_en || row.title}
City: ${row.city_name || row.city_name_local || 'Unknown'}
Description: ${row.short_description_en || row.short_description || ''}
Details: ${(row.long_description_en || row.long_description || '').substring(0, 500)}...`,
        metadata: {
          id: row.id,
          type: 'product',
          slug: row.slug_en || row.slug,
          city: row.city_name || row.city_name_local
        }
      }));

      // Search for Cities
      const citySql = `
        SELECT 
          id,
          name_en,
          name,
          description_en,
          description,
          country,
          slug_en,
          slug
        FROM public.cities_city
        WHERE 
          name_en ILIKE $1 OR
          name ILIKE $1 OR
          description_en ILIKE $1 OR
          description ILIKE $1
        LIMIT 3;
      `;

      const cityResult = await doQuery(citySql, [`%${query}%`]);

      const cityChunks = cityResult.rows.map((row: any) => ({
        source: `DO - City: ${row.name_en || row.name}`,
        content: `City: ${row.name_en || row.name}
Country: ${row.country}
Description: ${(row.description_en || row.description || '').substring(0, 500)}...`,
        metadata: {
          id: row.id,
          type: 'city',
          slug: row.slug_en || row.slug
        }
      }));

      return [...productChunks, ...cityChunks];
      
    } catch (error) {
      console.error('Error searching DigitalOcean:', error);
      return [];
    }
  }
}
