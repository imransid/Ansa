package assistant

// BrainRequest is what core sends the brain for one reply: ONE company's
// slice, never an id or another company's data. Its JSON names match the
// brain's ReplyRequest (brain/brain/assistant/models.py), which refuses any
// field it doesn't know.
type BrainRequest struct {
	Kind         string     `json:"kind"`
	Business     Business   `json:"business"`
	Hours        *Hours     `json:"hours"`
	Ordering     Ordering   `json:"ordering"`
	Orders       Orders     `json:"orders"`
	Menu         []MenuItem `json:"menu"`
	Instructions string     `json:"instructions"`
	Knowledge    string     `json:"knowledge"`
	Categories   []string   `json:"categories"`
	Conversation []Line     `json:"conversation"`
	// "api_key" (the business's own key below, or ansa's when nil) or
	// "claude_code" (development only: the brain refuses it in production).
	Engine string  `json:"engine"`
	APIKey *string `json:"api_key"`
}

type Business struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Address     string  `json:"address"`
	Phone       *string `json:"phone"`
}

type Hours struct {
	TimeZone string   `json:"time_zone"`
	Now      string   `json:"now"`
	Weekly   []string `json:"weekly"`
}

type Ordering struct {
	Delivery     bool   `json:"delivery"`
	DeliveryNote string `json:"delivery_note"`
	Pickup       bool   `json:"pickup"`
	PaymentNote  string `json:"payment_note"`
}

type Orders struct {
	TakesOrders bool     `json:"takes_orders"`
	DeliveryFee *string  `json:"delivery_fee"`
	InProgress  []string `json:"in_progress"`
	Placed      []string `json:"placed"`
}

type MenuItem struct {
	Label       string `json:"label"`
	Category    string `json:"category"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Price       string `json:"price"`
}

// Line is one message: sender "customer" or "restaurant" (anything sent to
// the customer: ansa, a person, the business's own app).
type Line struct {
	Sender string `json:"sender"`
	Text   string `json:"text"`
}

// Decision is the brain's answer (brain/brain/assistant/answer.py).
type Decision struct {
	Kind     string        `json:"kind"`
	Text     string        `json:"text"`
	Reason   string        `json:"reason"`
	Subject  string        `json:"subject"`
	Summary  string        `json:"summary"`
	Category string        `json:"category"`
	Order    *OrderRequest `json:"order"`
}

// OrderRequest is the order the brain names by menu label.
type OrderRequest struct {
	Items []struct {
		Label    string `json:"label"`
		Quantity int    `json:"quantity"`
	} `json:"items"`
	Fulfilment string `json:"fulfilment"`
	Address    string `json:"address"`
	Time       string `json:"time"`
	Notes      string `json:"notes"`
}
