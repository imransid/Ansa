package comments

import (
	"crypto/sha256"
	"encoding/binary"

	"ansa/core/internal/orders"
)

// ansa's own public notes under a comment, never the AI's: in English, and
// in Bangla for a comment written mostly in Bengali script (as ansa's order
// texts choose, orders.LanguageOf). Several of each, picked by the
// comment's id: identical replies under every comment look like spam to
// Meta and to people, and neighbouring comments get different ones.

// fixedNotes is one note's wordings in both languages.
type fixedNotes struct {
	English, Bangla []string
}

// A price question or an order: the details went (or go) in Messenger.
var orderNotes = fixedNotes{
	English: []string{
		"Thanks! We've sent you the details in Messenger 📩",
		"Thanks for asking! Check your Messenger for the details 📩",
		"Hi! We've messaged you the details 📩",
		"Thank you! The details are in your Messenger inbox 📩",
		"Thanks! We've sent you a message with everything 📩",
	},
	Bangla: []string{
		"ধন্যবাদ! মেসেঞ্জারে আপনাকে বিস্তারিত পাঠিয়েছি 📩",
		"ধন্যবাদ! বিস্তারিত জানতে আপনার মেসেঞ্জার দেখুন 📩",
		"জি, আপনাকে ইনবক্সে বিস্তারিত পাঠিয়েছি 📩",
		"জানতে চাওয়ার জন্য ধন্যবাদ! মেসেঞ্জারে মেসেজ দিয়েছি 📩",
		"ধন্যবাদ! আপনার ইনবক্স দেখুন, সব লিখে দিয়েছি 📩",
	},
}

// A complaint: a short apology in public, never an argument; the rest in private.
var complaintNotes = fixedNotes{
	English: []string{
		"So sorry about that! We've sent you a message.",
		"We're sorry to hear this. We've messaged you so we can make it right.",
		"Sorry about this! Please check your Messenger: we've written to you.",
		"We're really sorry. We've sent you a private message.",
		"Sorry for the trouble! We've reached out to you in Messenger.",
	},
	Bangla: []string{
		"দুঃখিত! আপনাকে মেসেঞ্জারে মেসেজ দিয়েছি।",
		"এমন হওয়ার জন্য আমরা দুঃখিত। আপনাকে ইনবক্সে মেসেজ দিয়েছি।",
		"সত্যিই দুঃখিত! আপনার মেসেঞ্জার দেখুন, আমরা লিখেছি।",
		"আমরা আন্তরিকভাবে দুঃখিত। আপনাকে একটি মেসেজ পাঠিয়েছি।",
		"অসুবিধার জন্য দুঃখিত! মেসেঞ্জারে আপনার সাথে যোগাযোগ করেছি।",
	},
}

// Anything else a person answers: thanks, and a message in private.
var unsureNotes = fixedNotes{
	English: []string{
		"Thanks for your comment! We've sent you a message.",
		"Thank you! We've messaged you in Messenger.",
		"Thanks! Please check your Messenger: we've written to you.",
		"Thanks for reaching out! We've sent you a private message.",
		"Thank you! We'll carry on in Messenger 📩",
	},
	Bangla: []string{
		"মন্তব্যের জন্য ধন্যবাদ! আপনাকে মেসেজ দিয়েছি।",
		"ধন্যবাদ! মেসেঞ্জারে আপনাকে লিখেছি।",
		"ধন্যবাদ! আপনার মেসেঞ্জার দেখুন, আমরা লিখেছি।",
		"যোগাযোগের জন্য ধন্যবাদ! আপনাকে ইনবক্সে মেসেজ দিয়েছি।",
		"ধন্যবাদ! মেসেঞ্জারে কথা বলি 📩",
	},
}

// pick is one wording of the note, in the comment's language, chosen by a
// hash of the comment's id (the same comment always gets the same one).
func pick(notes fixedNotes, in planInputs) string {
	wordings := notes.English
	if in.Language == orders.Bangla {
		wordings = notes.Bangla
	}
	sum := sha256.Sum256([]byte(in.CommentID))
	return wordings[binary.BigEndian.Uint64(sum[:8])%uint64(len(wordings))]
}
