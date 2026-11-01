package calls

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestAnUnsignedReportIsRefusedAndASignedOneIsSavedOnce(t *testing.T) {
	w := newCallWorld(t)
	ctx := context.Background()
	vapiID := "call-" + w.company.String()
	report := w.endOfCall(vapiID, "+39 051 555 0177", "AI: Hello.\nUser: My order is late.")
	if code, _ := w.post(report, false); code != 401 || w.callID(vapiID) != "" {
		t.Fatalf("unsigned: %d", code)
	}
	if code, _ := w.post(report, true); code != 200 {
		t.Fatalf("signed: %d", code)
	}
	if code, _ := w.post(report, true); code != 200 {
		t.Fatalf("again: %d", code)
	}
	var calls, jobs, messages int
	var sealed string
	w.pool.QueryRow(ctx, `SELECT count(*), max(transcript_encrypted) FROM calls WHERE company_id = $1`, w.company.String()).Scan(&calls, &sealed)
	w.pool.QueryRow(ctx, `SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind = $2`, w.company.String(), AnalyzeJobKind).Scan(&jobs)
	w.pool.QueryRow(ctx, `SELECT count(*) FROM messages WHERE company_id = $1 AND call_id IS NOT NULL`, w.company.String()).Scan(&messages)
	if calls != 1 || jobs != 1 || messages != 1 {
		t.Fatalf("saved once, analysis queued, in the caller's conversation: %d %d %d", calls, jobs, messages)
	}
	if strings.Contains(sealed, "late") {
		t.Fatal("the transcript is stored encrypted")
	}
}

func TestACallToAnUnknownLineIsIgnored(t *testing.T) {
	w := newCallWorld(t)
	report := w.endOfCall("call-x-"+w.company.String(), "+15550100", "AI: Hi.")
	report["message"].(map[string]any)["call"].(map[string]any)["phoneNumberId"] = "nobody's line"
	if code, _ := w.post(report, true); code != 200 || w.callID("call-x-"+w.company.String()) != "" {
		t.Fatalf("unknown line: %d", code)
	}
}

func TestTheLiveAssistantGetsTheCompanysApprovedArticlesOnly(t *testing.T) {
	w := newCallWorld(t)
	ctx := context.Background()
	var articleID string
	err := w.pool.QueryRow(ctx, `INSERT INTO knowledge_articles (company_id, title, body, kind, status, use_for_support, created_by_user_id, updated_by_user_id, approved_by_user_id, approved_at)
		VALUES ($1, 'Opening hours', 'We open at nine.', 'faq', 'approved', true, $2, $2, $2, now()) RETURNING id`, w.company.String(), w.owner).Scan(&articleID)
	if err != nil {
		t.Fatalf("article: %v", err)
	}
	w.pool.Exec(ctx, `INSERT INTO knowledge_chunks (company_id, article_id, position, heading, text) VALUES ($1, $2, 0, 'Opening hours', 'We open at nine.')`, w.company.String(), articleID)
	vapiID := "live-" + w.company.String()
	message := func(numberID string, arguments any) map[string]any {
		return map[string]any{"message": map[string]any{"type": "tool-calls", "artifact": map[string]any{"transcript": "secret"},
			"call": map[string]any{"id": vapiID, "phoneNumberId": numberID},
			"toolCallList": []any{
				map[string]any{"id": "t1", "function": map[string]any{"name": KnowledgeToolName, "arguments": arguments}},
				map[string]any{"id": "t2", "function": map[string]any{"name": "transfer_call", "arguments": map[string]any{}}},
				map[string]any{"function": map[string]any{"name": KnowledgeToolName}},
			}}}
	}
	code, body := w.post(message(w.numberID, `{"query":"When do you open?"}`), true)
	var answer ToolAnswer
	json.Unmarshal(body, &answer)
	if code != 200 || len(answer.Results) != 2 {
		t.Fatalf("one entry per tool call with an id: %d %s", code, body)
	}
	if !strings.Contains(answer.Results[0].Result, `<article title="Opening hours">We open at nine.</article>`) || answer.Results[1].Error != errorUnknownTool {
		t.Fatalf("answers: %+v", answer.Results)
	}
	var lookups, hits int
	w.pool.QueryRow(ctx, `SELECT count(*), coalesce(max(hit_count), 0) FROM knowledge_lookups WHERE company_id = $1 AND vapi_call_id = $2`, w.company.String(), vapiID).Scan(&lookups, &hits)
	if lookups != 1 || hits != 1 {
		t.Fatalf("the lookup is recorded: %d %d", lookups, hits)
	}
	_, body = w.post(message("nobody's line", map[string]any{"query": "When?"}), true)
	json.Unmarshal(body, &answer)
	if len(answer.Results) != 2 || answer.Results[0].Error != errorNotSetUp {
		t.Fatalf("an unknown line searches nothing: %s", body)
	}
	_, body = w.post(message(w.numberID, map[string]any{"query": ""}), true)
	json.Unmarshal(body, &answer)
	if answer.Results[0].Error != errorBadArguments {
		t.Fatalf("an empty question: %s", body)
	}
}
