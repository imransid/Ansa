package main

import (
	"context"
	"fmt"
	"io"

	"ansa/core/internal/autopost"
	"ansa/core/internal/channels"
	"ansa/core/internal/conversations"
	"ansa/core/internal/hours"
	"ansa/core/internal/logging"
	"ansa/core/internal/menu"
	"ansa/core/internal/settings"
	"ansa/core/internal/setup"
	"ansa/core/internal/socialconnect"
	"ansa/core/internal/whatsapp"
)

// The demo restaurant's menu, in taka.
var demoMenu = []menu.Typed{
	{Category: "Biryani", Name: "Kacchi Biryani", Description: "Mutton and rice cooked together, with potato and egg.", Price: "450"},
	{Category: "Biryani", Name: "Chicken Biryani", Description: "With a boiled egg.", Price: "350"},
	{Category: "Biryani", Name: "Morog Polao", Description: "Chicken with fragrant rice.", Price: "380"},
	{Category: "Curries", Name: "Beef Bhuna", Description: "Slow-cooked and spicy.", Price: "320"},
	{Category: "Curries", Name: "Rui Fish Curry", Description: "Home style, with tomato.", Price: "300"},
	{Category: "Sides", Name: "Plain Rice", Description: "", Price: "60"},
	{Category: "Drinks and desserts", Name: "Borhani", Description: "Spiced yoghurt drink.", Price: "80"},
	{Category: "Drinks and desserts", Name: "Mango Lassi", Description: "", Price: "120"},
	{Category: "Drinks and desserts", Name: "Firni", Description: "Rice pudding.", Price: "90"},
}

// setUpRestaurant goes through a restaurant's setup as the welcome pages do,
// adds its menu, connects its stand-in accounts and switches "Post for me" on.
func setUpRestaurant(ctx context.Context, w *world, a demoAccount) error {
	restaurant := "restaurant"
	business := setup.Business{Kind: "business", CompanyName: "Shapla Kitchen", BusinessType: &restaurant,
		Description: "Home-style Bangladeshi food: kacchi, biryani, curries and fresh fish."}
	contact := setup.Contact{Address: "Road 27, Dhanmondi, Dhaka", Phone: "+880 1700 000000"}
	orders := setup.Orders{TakesOrders: true, Delivery: true, DeliveryNote: "Within 5 km of Dhanmondi, in about 45 minutes.", DeliveryFee: "60",
		Pickup: true, PaymentNote: "Cash on delivery or bKash.", Currency: "BDT"}
	answering := setup.Answering{
		Instructions: "Answer warmly and briefly, in the customer's language (Bangla or English). Kacchi and biryani are cooked fresh from 12:00 every day. " +
			"For a party of 20 or more, take their name and number: the manager calls them back.",
		HoldingReply: "Thanks for your message! Someone from Shapla Kitchen will get back to you very soon.",
	}
	if err := saveSetup(ctx, w, a, &business, &contact, everyDay("10:00", "00:00"), &orders, &answering); err != nil {
		return err
	}
	if err := addDemoMenu(ctx, w, a); err != nil {
		return err
	}
	if err := connectStandIns(ctx, w, a, true); err != nil {
		return err
	}
	posts := autopost.Choices{Enabled: true, Frequency: autopost.FrequencyThreeAWeek, Clock: "11:00", Mode: "automatic"}
	outcome, err := autopost.Save(ctx, w.pool, a.company, a.userID, posts)
	if err := saved("Post for me", outcome, err); err != nil {
		return err
	}
	if err := setUpRestaurantTeam(ctx, w, a); err != nil {
		return err
	}
	if err := addSavedAnswers(ctx, w, a, restaurantAnswers); err != nil {
		return err
	}
	chats, err := playDemoChats(ctx, w, a, restaurantHistory)
	if err != nil {
		return err
	}
	if err := finishDemoOrder(ctx, w, a, chats[doneOrderCustomer]); err != nil {
		return err
	}
	if err := addDemoCallsAndEmails(ctx, w, a); err != nil {
		return err
	}
	return setUpMarketing(ctx, w, a)
}

// setUpPerson sets up one person (a freelance designer) away from their
// phone, so ansa answers for them at once.
func setUpPerson(ctx context.Context, w *world, a demoAccount) error {
	person := setup.Business{Kind: "personal", CompanyName: "Rafa", Description: "Freelance designer in Dhaka: logos, menus and social media posts."}
	answering := setup.Answering{
		Instructions: "A logo starts at 15,000 taka and takes about a week. I'm usually free for calls after 6 pm. Never agree to a meeting or a price for me: say I'll confirm.",
		HoldingReply: "Thanks for your message! Rafa can't answer right now and will get back to you soon.",
	}
	nights := map[string][]hours.Range{}
	for _, day := range []string{"mon", "tue", "wed", "thu", "fri", "sat", "sun"} {
		nights[day] = []hours.Range{{Opens: "00:00", Closes: "08:00"}, {Opens: "22:00", Closes: "00:00"}}
	}
	grace := 10
	if err := saveSetup(ctx, w, a, &person, nil, &setup.Week{TimeZone: "Asia/Dhaka", Hours: nights, ReplyGraceMinutes: &grace}, nil, &answering); err != nil {
		return err
	}
	if err := connectStandIns(ctx, w, a, false); err != nil {
		return err
	}
	outcome, err := settings.SetAway(ctx, w.pool, a.company, a.userID, true)
	if err := saved("\"I'm away\"", outcome, err); err != nil {
		return err
	}
	if err := addSavedAnswers(ctx, w, a, personAnswers); err != nil {
		return err
	}
	_, err = playDemoChats(ctx, w, a, personHistory)
	return err
}

// addDemoMenu adds the restaurant's dishes, priced in its currency.
func addDemoMenu(ctx context.Context, w *world, a demoAccount) error {
	var dishes []menu.Fields
	for _, typed := range demoMenu {
		dish, problems := typed.Check("BDT")
		if err := checked("menu", problems); err != nil {
			return err
		}
		dishes = append(dishes, dish)
	}
	outcome, err := menu.Add(ctx, w.pool, a.company, a.userID, dishes)
	return saved("menu", outcome, err)
}

// connectStandIns connects the stand-in Telegram account and WhatsApp
// number, and for a business the stand-in Facebook Page (Messenger and
// posts). A Facebook Page needs no stand-in when ansa's Meta app is set up
// here: then the demo goes on without it.
func connectStandIns(ctx context.Context, w *world, a demoAccount, facebook bool) error {
	id, err := conversations.NewID()
	if err != nil {
		return err
	}
	numbers := &whatsapp.Connector{Pool: w.pool, Box: w.box, Development: true}
	err = runSteps([]demoStep{
		{"stand-in Telegram account", func() (string, error) {
			return channels.ConnectStandIn(ctx, w.pool, a.company, a.userID, "stand-in:"+id)
		}},
		{"stand-in WhatsApp number", func() (string, error) { return numbers.ConnectStandIn(ctx, a.company, a.userID) }},
	})
	if err != nil {
		return err
	}
	if !facebook {
		return nil
	}
	pages := &socialconnect.Connector{Pool: w.pool, Box: w.box, Log: logging.New(io.Discard), AppID: w.cfg.FacebookAppID, AppSecret: w.cfg.FacebookAppSecret,
		AppURL: w.cfg.AppURL, Development: true}
	outcome, err := pages.ConnectStandIn(ctx, a.company, a.userID, "facebook")
	if err == nil && outcome == "not-set-up" {
		fmt.Fprintln(w.out, "No stand-in Facebook Page: ansa's Meta app is set up here (Messenger and Post for me need a real Page).")
		return nil
	}
	return saved("stand-in Facebook Page", outcome, err)
}
