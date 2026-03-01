/**
 * Pagination helpers
 * Usage:
 *   const { page, limit, offset } = getPagination(req.query);
 *   const { rows } = await pool.query('SELECT ... LIMIT $N OFFSET $N+1', [...params, limit, offset]);
 *   const { rows: [{ total }] } = await pool.query('SELECT COUNT(*) AS total FROM ...', params);
 *   res.json(buildPage(rows, parseInt(total), page, limit));
 */
function getPagination(query) {
    const page  = Math.max(1, parseInt(query.page)  || 1);
    const limit = Math.min(200, Math.max(1, parseInt(query.limit) || 25));
    return { page, limit, offset: (page - 1) * limit };
}

function buildPage(rows, total, page, limit) {
    return {
        data:  rows,
        total: total,
        page:  page,
        limit: limit,
        pages: Math.ceil(total / limit)
    };
}

module.exports = { getPagination, buildPage };
