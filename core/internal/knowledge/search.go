// Package knowledge is the company's knowledge base, as far as core uses it
// today (the old db/knowledge-search.ts, lib/knowledge/search-query.ts and
// prompt-slice.ts): searching the company's APPROVED articles for one
// audience, and the escaped <article> blocks the AI reads. Writing,
// approving and importing articles move with the Knowledge page.
package knowledge

import (
	"context"
	"regexp"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// Hit is one matching piece of an approved article (at most 1,500 characters).
type Hit struct {
	ArticleID, Title, Kind, Text string
	Rank                         float64
}

// The most words one query keeps, the longest word, and the length from
// which a word also matches longer ones ("refund" finds "refunds").
const (
	maxQueryWords         = 20
	maxWordLength         = 100
	prefixMatchFromLength = 4
	// The most hits one search returns, and pieces of one article among them.
	maxHits         = 10
	maxPiecesPerHit = 2
)

// Words that say nothing about what is asked (English only, short on
// purpose: the 'simple' configuration has no stop words of its own).
var stopWords = map[string]bool{}

func init() {
	for _, word := range strings.Fields(`an and are as at be but by can could did do does for from
		had has have he hello her hi his how if in is it its me my no not of on or our please she so thank
		thanks that the their them then there they this to us was we were what when where which who why will
		with would you your`) {
		stopWords[word] = true
	}
}

var wordPattern = regexp.MustCompile(`[\p{L}\p{M}\p{N}]+`)

// BuildTsQuery turns what someone asked into the query for
// to_tsquery('simple', ...): the words (letters, marks and digits only, so
// no operator or quote of Postgres's gets through), lower-cased in their
// NFKC form, each once, at most 20, OR-ed, 4+ letters as a prefix. "" when
// no word is left: then no search runs at all. It still goes to Postgres as
// a parameter, never as SQL text.
func BuildTsQuery(text string) string {
	var terms []string
	seen := map[string]bool{}
	for _, word := range wordPattern.FindAllString(strings.ToLower(norm.NFKC.String(text)), -1) {
		length := utf8.RuneCountInString(word)
		if length < 2 || length > maxWordLength || stopWords[word] || seen[word] {
			continue
		}
		seen[word] = true
		if length >= prefixMatchFromLength {
			word += ":*"
		}
		terms = append(terms, word)
		if len(terms) == maxQueryWords {
			break
		}
	}
	return strings.Join(terms, " | ")
}

// Search searches one company's approved articles ticked for the audience
// ("support" or "marketing"), best first (ts_rank_cd: how many of the
// words, how close together, title words counting most), at most 2 pieces
// of one article, limit hits (1-10). The company first, on both tables.
func Search(ctx context.Context, pool *database.Pool, company tenant.CompanyID, query, audience string, limit int) ([]Hit, error) {
	tsQuery := BuildTsQuery(query)
	if tsQuery == "" {
		return nil, nil
	}
	limit = min(max(limit, 1), maxHits)
	const statement = `
		WITH ranked AS (
			SELECT chunks.article_id, articles.title, articles.kind, chunks.text, chunks.position,
				ts_rank_cd(chunks.search_vector, to_tsquery('simple', $2)) AS rank,
				row_number() OVER (PARTITION BY chunks.article_id ORDER BY ts_rank_cd(chunks.search_vector, to_tsquery('simple', $2)) DESC, chunks.position) AS place_in_article
			FROM knowledge_chunks AS chunks
			JOIN knowledge_articles AS articles ON articles.id = chunks.article_id AND articles.company_id = chunks.company_id
			WHERE chunks.company_id = $1 AND articles.company_id = $1 AND articles.status = 'approved'
				AND CASE WHEN $3 = 'support' THEN articles.use_for_support ELSE articles.use_for_marketing END
				AND chunks.search_vector @@ to_tsquery('simple', $2)
		)
		SELECT article_id, title, kind, text, rank FROM ranked
		WHERE place_in_article <= $4
		ORDER BY rank DESC, article_id, position
		LIMIT $5`
	rows, err := pool.Query(ctx, statement, company.String(), tsQuery, audience, maxPiecesPerHit, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var hits []Hit
	for rows.Next() {
		var hit Hit
		var rank float32
		if err := rows.Scan(&hit.ArticleID, &hit.Title, &hit.Kind, &hit.Text, &rank); err != nil {
			return nil, err
		}
		hit.Rank = float64(rank)
		hits = append(hits, hit)
	}
	return hits, rows.Err()
}

// Slice is the best hits first, each whole in its own <article> tags with
// title and text escaped (so nothing an article says can close the tag or
// open another), while they fit in maxCharacters. The first one that
// doesn't fit is left out, and everything after it: the AI never reads half
// a piece and takes it for the whole answer.
func Slice(hits []Hit, maxCharacters int) (kept []Hit, text string) {
	var blocks []string
	length := 0
	for _, hit := range hits {
		block := `<article title="` + escapeHTML(hit.Title) + "\">\n" + escapeHTML(hit.Text) + "\n</article>"
		withBlock := length + utf16Length(block)
		if len(blocks) > 0 {
			withBlock += 2
		}
		if withBlock > maxCharacters {
			break
		}
		kept = append(kept, hit)
		blocks = append(blocks, block)
		length = withBlock
	}
	return kept, strings.Join(blocks, "\n\n")
}

var htmlEscaper = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;")

func escapeHTML(text string) string {
	return htmlEscaper.Replace(text)
}

// utf16Length counts as the old JavaScript did (.length: UTF-16 units), so
// both backends keep the same hits.
func utf16Length(text string) int {
	n := 0
	for _, r := range text {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}
