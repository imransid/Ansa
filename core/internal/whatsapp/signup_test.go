package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"regexp"
	"strings"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/secure"
	"ansa/core/internal/settings"
	"ansa/core/internal/social"
	"ansa/core/internal/tenant"
)

const appID = "987654"

// metaSays is a fake Meta for one sign-up of WABA 777 and the number
// `phone`: each step's answer can be changed.
type metaSays struct {
	phone                                                        string
	exchange, debug, numbers, subscribe, register                string
	exchangeStatus, debugStatus, subscribeStatus, registerStatus int
}

func newMetaSays(phone string) *metaSays {
	return &metaSays{phone: phone,
		exchange:  `{"access_token":"business-token","token_type":"bearer"}`,
		debug:     `{"data":{"app_id":"` + appID + `","is_valid":true,"granular_scopes":[{"scope":"whatsapp_business_messaging","target_ids":["777"]}]}}`,
		numbers:   `{"data":[{"id":"` + phone + `","display_phone_number":"+880 1711-223344","verified_name":"Luigi's","is_on_biz_app":false}]}`,
		subscribe: `{"success":true}`, register: `{"success":true}`,
		exchangeStatus: 200, debugStatus: 200, subscribeStatus: 200, registerStatus: 200}
}

func (m *metaSays) answer(path, _ string) (int, string) {
	switch path {
	case "/oauth/access_token":
		return m.exchangeStatus, m.exchange
	case "/debug_token":
		return m.debugStatus, m.debug
	case "/777/phone_numbers":
		return 200, m.numbers
	case "/777/subscribed_apps":
		return m.subscribeStatus, m.subscribe
	case "/" + m.phone + "/register":
		return m.registerStatus, m.register
	}
	return 404, `{}`
}

func signup(phone string) Signup {
	return Signup{Code: "one-time-code", WABAID: "777", PhoneNumberID: phone}
}

func codeOf(err error) string {
	var refused *SignupError
	if errors.As(err, &refused) {
		return refused.Code
	}
	return fmt.Sprint(err)
}

// Meta confirms the sign-up server to server before anything is saved: the
// code, the token (ansa's app's, for that account), the number among the
// account's, the webhooks, and a number not used in the app registered.
func TestMetaConfirmsTheSignupBeforeAnythingIsSaved(t *testing.T) {
	meta := newMetaSays("106540352242922")
	graph := newFakeGraph(t, meta.answer)
	number, err := Confirm(context.Background(), appID, appSecret, signup(meta.phone))
	if err != nil || number.Token != "business-token" || number.DisplayPhoneNumber != "+880 1711-223344" || number.VerifiedName != "Luigi's" || number.SharedWithApp {
		t.Fatalf("confirmed: %+v %v", number, err)
	}
	last := graph.bodies[len(graph.bodies)-1]
	if graph.requests[len(graph.requests)-1].URL.Path != "/106540352242922/register" || !regexp.MustCompile(`"pin":"[0-9]{6}"`).MatchString(last) {
		t.Fatalf("a new number is registered with a six-digit PIN: %s", last)
	}
	if strings.Contains(graph.requests[0].URL.String(), "business-token") {
		t.Fatal("the business's token never goes in an address")
	}

	meta.numbers = strings.Replace(meta.numbers, `"is_on_biz_app":false`, `"is_on_biz_app":true`, 1)
	graph = newFakeGraph(t, meta.answer)
	if number, err := Confirm(context.Background(), appID, appSecret, signup(meta.phone)); err != nil || !number.SharedWithApp || strings.HasSuffix(graph.requests[len(graph.requests)-1].URL.Path, "/register") {
		t.Fatalf("a number the WhatsApp Business app uses (Meta says so, not the browser) is never registered again: %+v %v", number, err)
	}

	refusals := []struct {
		change func(m *metaSays)
		code   string
	}{
		{func(m *metaSays) { m.exchangeStatus, m.exchange = 400, `{"error":{"code":100}}` }, SignupCodeRefused},
		{func(m *metaSays) { m.debug = strings.Replace(m.debug, appID, "1111", 1) }, SignupNotGranted},
		{func(m *metaSays) { m.debug = strings.Replace(m.debug, `["777"]`, `["778"]`, 1) }, SignupNotGranted},
		{func(m *metaSays) { m.numbers = `{"data":[{"id":"5","display_phone_number":"+1"}]}` }, SignupNumberUnknown},
		{func(m *metaSays) { m.subscribeStatus, m.subscribe = 400, `{"error":{"code":200}}` }, SignupSubscribeFailed},
		{func(m *metaSays) { m.registerStatus, m.register = 400, `{"error":{"code":133005}}` }, SignupRegisterFailed},
	}
	for index, refusal := range refusals {
		meta := newMetaSays("106540352242922")
		refusal.change(meta)
		newFakeGraph(t, meta.answer)
		if _, err := Confirm(context.Background(), appID, appSecret, signup(meta.phone)); codeOf(err) != refusal.code {
			t.Fatalf("refusal %d: %v", index, err)
		}
	}
	graph = newFakeGraph(t, newMetaSays("1").answer)
	if _, err := Confirm(context.Background(), appID, appSecret, Signup{Code: "c", WABAID: "777", PhoneNumberID: "12/register"}); codeOf(err) != SignupNumberUnknown || len(graph.requests) != 0 {
		t.Fatalf("an id that isn't Meta's is refused before asking Meta: %v", err)
	}
}

// numberWorld is a company with an owner, and the connector with a fake Meta.
type numberWorld struct {
	pool      *database.Pool
	box       *secure.Box
	companyID string
	company   tenant.CompanyID
	owner     string
	connector *Connector
}

func newNumberWorld(t *testing.T) *numberWorld {
	pool := database.ForTest(t)
	w := &numberWorld{pool: pool}
	w.companyID = database.TestCompany(t, pool)
	w.company, _ = tenant.FromTrustedSource(w.companyID)
	w.owner = database.TestOwner(t, pool, w.companyID)
	w.box, _ = secure.NewBox("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	w.connector = &Connector{Pool: pool, Box: w.box, AppID: appID, AppSecret: appSecret, SignupConfigID: "123"}
	return w
}

func randomPhoneID() string {
	return fmt.Sprint(rand.Uint64N(1 << 62))
}

// Owners connect one number per company; its token is saved encrypted for
// that company and number; a number connected elsewhere is refused;
// disconnecting deletes the token.
func TestAnOwnerConnectsOneNumberAndItsTokenIsEncrypted(t *testing.T) {
	w := newNumberWorld(t)
	ctx := context.Background()
	phone := randomPhoneID()
	meta := newMetaSays(phone)
	graph := newFakeGraph(t, meta.answer)

	member := database.TestOwner(t, w.pool, w.companyID)
	if _, err := w.pool.Exec(ctx, `UPDATE users SET role = 'member' WHERE company_id = $1 AND id = $2`, w.companyID, member); err != nil {
		t.Fatal(err)
	}
	if outcome, err := w.connector.Connect(ctx, w.company, member, signup(phone)); err != nil || outcome != settings.NotAllowed || len(graph.requests) != 0 {
		t.Fatalf("a member is refused before Meta is asked: %q %v", outcome, err)
	}
	if outcome, err := w.connector.Connect(ctx, w.company, w.owner, signup(phone)); err != nil || outcome != settings.Saved {
		t.Fatalf("connected: %q %v", outcome, err)
	}
	var id, stored string
	if err := w.pool.QueryRow(ctx, `SELECT id, token_encrypted FROM whatsapp_numbers WHERE company_id = $1 AND phone_number_id = $2 AND status = 'connected'`, w.companyID, phone).Scan(&id, &stored); err != nil {
		t.Fatal(err)
	}
	if token, err := social.WhatsAppToken(ctx, w.pool, w.box, w.company, id); err != nil || token != "business-token" || strings.Contains(stored, "business-token") {
		t.Fatalf("the token is stored encrypted and read back for a send: %q %v", token, err)
	}
	asked := len(graph.requests)
	if outcome, _ := w.connector.Connect(ctx, w.company, w.owner, signup(phone)); outcome != AlreadyConnected || len(graph.requests) != asked {
		t.Fatalf("one number per company, checked before Meta is asked: %q", outcome)
	}

	other := newNumberWorld(t)
	if outcome, err := other.connector.Connect(ctx, other.company, other.owner, signup(phone)); err != nil || outcome != ConnectedElsewhere {
		t.Fatalf("a number connected in another company: %q %v", outcome, err)
	}

	if outcome, err := Disconnect(ctx, w.pool, w.company, w.owner); err != nil || outcome != settings.Saved {
		t.Fatalf("disconnected: %q %v", outcome, err)
	}
	if _, err := social.WhatsAppToken(ctx, w.pool, w.box, w.company, id); !errors.Is(err, social.ErrNotUsable) {
		t.Fatalf("a disconnected number's token is gone: %v", err)
	}
	if outcome, err := other.connector.Connect(ctx, other.company, other.owner, signup(phone)); err != nil || outcome != settings.Saved {
		t.Fatalf("once disconnected here, another company may connect it: %q %v", outcome, err)
	}
}

// Development without ansa's Meta app: a stand-in number, no token.
func TestAStandInNumberInDevelopment(t *testing.T) {
	w := newNumberWorld(t)
	w.connector = &Connector{Pool: w.pool, Box: w.box, Development: true}
	if w.connector.Mode() != "stand-in" || (&Connector{}).Mode() != "not-set-up" || (&Connector{AppID: "1", AppSecret: "s", SignupConfigID: "2"}).Mode() != "real" {
		t.Fatal("the modes")
	}
	if outcome, err := w.connector.ConnectStandIn(context.Background(), w.company, w.owner); err != nil || outcome != settings.Saved {
		t.Fatalf("stand-in: %q %v", outcome, err)
	}
	var count int
	w.pool.QueryRow(context.Background(), `SELECT count(*) FROM whatsapp_numbers WHERE company_id = $1 AND is_stand_in AND token_encrypted IS NULL AND phone_number_id LIKE 'stand-in:%'`, w.companyID).Scan(&count)
	if count != 1 {
		t.Fatal("one stand-in number, without a token")
	}
}
