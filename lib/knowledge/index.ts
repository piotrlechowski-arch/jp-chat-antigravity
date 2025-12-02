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
      const lowerQuery = query.toLowerCase();
      
      // Intent: List all tours/products
      if (lowerQuery.includes('list') && (lowerQuery.includes('tour') || lowerQuery.includes('product'))) {
        console.log('Detected Intent: List All Tours');
        const listSql = `
          SELECT 
            p.title_en,
            p.title,
            c.name_en as city_name
          FROM main.products_product p
          LEFT JOIN public.cities_city c ON p.city_id = c.id
          WHERE p.is_active = true OR p.status = 'active' -- Assuming there's a status/active flag, if not remove
          ORDER BY p.title_en
          LIMIT 50;
        `;
        // Note: I don't see is_active in the schema, so I'll just limit to 50 for now without filter
        const safeListSql = `
          SELECT 
            p.title_en,
            p.title,
            c.name_en as city_name
          FROM main.products_product p
          LEFT JOIN public.cities_city c ON p.city_id = c.id
          ORDER BY p.title_en
          LIMIT 50;
        `;
        
        const listResult = await doQuery(safeListSql, []);
        const listContent = listResult.rows.map((r: any) => `- ${r.title_en || r.title} (${r.city_name || 'Unknown City'})`).join('\n');
        
        return [{
          source: 'DO - Tour List',
          content: `Here is a list of up to 50 tours available:\n${listContent}`,
          metadata: { type: 'list', count: listResult.rows.length }
        }];
      }

      // Intent: Booking Stats
      if (lowerQuery.includes('booking') || lowerQuery.includes('reservation') || lowerQuery.includes('how many')) {
        console.log('Detected Intent: Booking Stats');
        const cleanQuery = query.replace(/how many|bookings|reservations|for/gi, '').trim();
        console.log('Cleaned Query for Stats:', cleanQuery);
        
        // Use LEFT JOINs to ensure we get products even with 0 bookings
        const statsSql = `
          SELECT 
            p.title_en,
            p.title,
            COUNT(b.id) as total_bookings,
            COUNT(bi.id) as total_participants
          FROM main.products_product p
          LEFT JOIN main.tours_tour t ON t.product_id = p.id
          LEFT JOIN main.bookings_booking b ON b.tour_id = t.id
          LEFT JOIN main.bookings_bookingitem bi ON bi.booking_id = b.id
          WHERE 
            p.title_en ILIKE $1 OR
            p.title ILIKE $1
          GROUP BY p.id, p.title_en, p.title
          LIMIT 5;
        `;
        
        const statsResult = await doQuery(statsSql, [`%${cleanQuery}%`]);
        console.log('Stats Search Results:', statsResult.rows.length);
        
        if (statsResult.rows.length > 0) {
          return statsResult.rows.map((row: any) => ({
            source: `DO - Stats: ${row.title_en || row.title}`,
            content: `Booking Statistics for "${row.title_en || row.title}":
- Total Bookings: ${row.total_bookings}
- Total Participants (approx): ${row.total_participants}`,
            metadata: { type: 'stats', id: row.id }
          }));
        }
      }

      // Default Intent: Search for Products (Tours) & Cities
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
