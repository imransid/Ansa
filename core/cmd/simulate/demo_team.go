package main

import (
	"context"
	"fmt"
	"io"
	"time"

	"ansa/core/internal/accounts"
	"ansa/core/internal/commands"
	"ansa/core/internal/conversations"
	"ansa/core/internal/email"
	"ansa/core/internal/knowledge"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/teammates"
)

// The restaurant's teammate: a member who handles deliveries and complaints.
const demoTeammateEmail = "karim@demo.ansa.test"

// setUpRestaurantTeam adds the request categories, Karim (joined through an
// invite, as a teammate does) and who handles which, so requests route.
func setUpRestaurantTeam(ctx context.Context, w *world, a demoAccount) error {
	for _, name := range []string{"Orders", "Delivery", "Complaints", "Catering"} {
		outcome, err := teammates.CreateCategory(ctx, w.pool, a.company, name)
		if err := saved("category "+name, outcome, err); err != nil {
			return err
		}
	}
	token, outcome, err := teammates.CreateInvite(ctx, w.pool, a.company, a.userID, demoTeammateEmail, "member", time.Now())
	if err != nil {
		return err
	}
	if token == "" {
		return commands.Refusal("The demo's invite wasn't made (" + outcome + ").")
	}
	run, err := conversations.NewID()
	if err != nil {
		return err
	}
	service := &accounts.Service{Pool: w.pool, Secret: w.cfg.AuthSecret, AppURL: w.cfg.AppURL, Mail: &email.Sender{DevFolder: w.cfg.DevFolder},
		Limits: ratelimit.New(w.pool, w.cfg.AuthSecret), Log: logging.New(io.Discard)}
	message, err := service.JoinWithInvite(ctx, token, accounts.NewPerson{Name: "Karim Hossain", Email: demoTeammateEmail, Password: demoPassword}, accounts.Request{IP: "demo-tool-" + run})
	if err != nil {
		return err
	}
	if message != "" {
		return commands.Refusal("Karim's joining was refused: " + message)
	}
	var karim string
	if err := w.pool.QueryRow(ctx, `SELECT id FROM users WHERE company_id = $1 AND email = $2`, a.company.String(), demoTeammateEmail).Scan(&karim); err != nil {
		return err
	}
	// Standing in for the emailed link (development only).
	if _, err := w.pool.Exec(ctx, `UPDATE users SET email_verified = true WHERE company_id = $1 AND id = $2`, a.company.String(), karim); err != nil {
		return err
	}
	ids, err := categoryIDs(ctx, w, a)
	if err != nil {
		return err
	}
	for person, names := range map[string][]string{a.userID: {"Orders", "Catering"}, karim: {"Delivery", "Complaints"}} {
		chosen := []string{ids[names[0]], ids[names[1]]}
		if done, err := teammates.SaveCategoriesOf(ctx, w.pool, a.company, person, chosen); err != nil || !done {
			if err != nil {
				return err
			}
			return commands.Refusal("The demo's categories weren't saved.")
		}
	}
	fmt.Fprintf(w.out, "Added Karim (%s), a member who handles deliveries and complaints.\n", demoTeammateEmail)
	return nil
}

func categoryIDs(ctx context.Context, w *world, a demoAccount) (map[string]string, error) {
	rows, err := w.pool.Query(ctx, `SELECT id::text, name FROM categories WHERE company_id = $1`, a.company.String())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := map[string]string{}
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		ids[name] = id
	}
	return ids, rows.Err()
}

// addSavedAnswers adds approved knowledge articles (Saved answers) the
// assistant may quote, as an owner writes and approves them.
func addSavedAnswers(ctx context.Context, w *world, a demoAccount, articles []knowledge.Fields) error {
	ids, outcome, err := knowledge.CreateDrafts(ctx, w.pool, a.company, a.userID, articles, knowledge.Source{})
	if err != nil {
		return err
	}
	if outcome != "created" {
		return commands.Refusal("The demo's saved answers weren't saved (" + outcome + ").")
	}
	for _, id := range ids {
		if outcome, err := knowledge.ChangeStatus(ctx, w.pool, a.company, a.userID, id, "approve", 1); err != nil || outcome != "changed" {
			if err != nil {
				return err
			}
			return commands.Refusal("A demo saved answer wasn't approved (" + outcome + ").")
		}
	}
	return nil
}

// The restaurant's saved answers, each in English and in Bangla: the search
// matches words, so a Bangla question finds only Bangla words. Each is short
// (the assistant reads at most 3,000 characters of them).
var restaurantAnswers = []knowledge.Fields{
	{Title: "Allergens", Kind: "faq", UseForSupport: true,
		Body: "Our Firni contains milk and cashew nuts. The biryanis are cooked with ghee (dairy). Borhani and Mango Lassi contain yoghurt. " +
			"Please tell us about any allergy before you order: our kitchen uses nuts, so we can't promise a nut-free dish.\n\n" +
			"অ্যালার্জি: আমাদের ফিরনিতে দুধ আর কাজুবাদাম আছে। বিরিয়ানি ঘি দিয়ে রান্না হয়। বোরহানি আর ম্যাঙ্গো লাস্সিতে দই আছে। " +
			"কোনো অ্যালার্জি থাকলে অর্ডারের আগে জানান: আমাদের রান্নাঘরে বাদাম ব্যবহার হয়, তাই বাদাম ছাড়া খাবারের নিশ্চয়তা দিতে পারি না।"},
	{Title: "Catering and parties", Kind: "policy", UseForSupport: true, UseForMarketing: true,
		Body: "We cater parties from 20 to 300 guests: weddings, office lunches and family events. The manager calls back within a day " +
			"with a menu and a price. Please ask at least three days ahead.\n\n" +
			"ক্যাটারিং: আমরা ২০ থেকে ৩০০ জন অতিথির ক্যাটারিং করি: বিয়ে, অফিসের লাঞ্চ আর পারিবারিক অনুষ্ঠান। " +
			"ম্যানেজার এক দিনের মধ্যে মেনু আর দাম জানিয়ে ফোন করেন। অন্তত তিন দিন আগে জানান।"},
	{Title: "Seating and parking", Kind: "faq", UseForSupport: true,
		Body: "We have 40 seats inside and a family room upstairs. There is street parking on Road 27 in the evening; at lunchtime " +
			"the parking behind the building on Road 26 is easier.\n\n" +
			"বসার জায়গা ও পার্কিং: ভেতরে ৪০টি আসন আর ওপরে একটি ফ্যামিলি রুম আছে। সন্ধ্যায় রোড ২৭-এ রাস্তায় পার্কিং করা যায়; " +
			"দুপুরে রোড ২৬-এ ভবনের পেছনের পার্কিং সহজ।"},
	{Title: "Our story", Kind: "guide", UseForMarketing: true,
		Body: "Shapla Kitchen started in 2019 as a family kitchen in Dhanmondi. Our head cook learned kacchi from her grandmother in " +
			"old Dhaka, and we still cook it the same way every morning. Most of our customers are families and office teams nearby."},
}

// Rafa's saved answers.
var personAnswers = []knowledge.Fields{
	{Title: "Services and how Rafa works", Kind: "faq", UseForSupport: true,
		Body: "Rafa designs logos, menus and social media posts. A logo starts at 15,000 taka and takes about a week, with two rounds " +
			"of changes. Rafa answers messages in the evening and confirms every price and date personally.\n\n" +
			"কাজ ও দাম: রাফা লোগো, মেনু আর সোশ্যাল মিডিয়া পোস্ট ডিজাইন করেন। একটি লোগো ১৫,০০০ টাকা থেকে শুরু, " +
			"সময় লাগে প্রায় এক সপ্তাহ, দুইবার পরিবর্তন করা যায়। রাফা সন্ধ্যায় মেসেজের উত্তর দেন আর প্রতিটি দাম ও তারিখ নিজে নিশ্চিত করেন।"},
}
