# logging (core/internal/logging)

**What:** one JSON line per event: a fixed event name and safe fields only.
**Rules:** there is no way to log free text, a body or an error's message:
only `Code`, `Count`, `Took` and `ErrorType` (the error's Go type). Customers'
words, names, tokens and keys can't reach a log by accident.
**Tests:** `logging_test.go`: an error's message never appears, its type does.
