import { createApiHandler } from "@/lib/server/api-handler.js";

const handler = createApiHandler({
  query: async () => ({
    sql: `
      SELECT
        cd.id,
        cd.name,
        cd.name_en,
        cd.category_type,
        cd.parent_id,
        parent.name AS parent_name,
        parent.name_en AS parent_name_en,
        cd.display_order,
        parent.display_order AS parent_display_order
      FROM category_definitions cd
      LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
      WHERE cd.is_active = 1
      ORDER BY
        cd.category_type,
        COALESCE(parent.display_order, 0),
        cd.display_order,
        cd.name
    `
  }),
  transform: (result) =>
    result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      nameEn: row.name_en,
      categoryType: row.category_type,
      parentId: row.parent_id,
      parentName: row.parent_name,
      parentNameEn: row.parent_name_en
    }))
});

export default handler;
