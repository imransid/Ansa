import "server-only";
import type { ModelRequest, ModelResult } from "@/lib/model-request";

// The development stand-in for "Read my menu" (step 46), used without an
// ANTHROPIC_API_KEY so the whole flow (reading, checking the list, "Looks
// right") can be tried for free. It never looks at the photo or text: it
// answers a fixed sample menu, as Claude's answer would look, and the page
// says it is a sample. Production never uses it (lib/menu.ts,
// menuStandInAllowed).
export async function askStandInForMenuReading(_request: ModelRequest): Promise<ModelResult> {
  const items = [
    { category: "Pizzas", name: "Margherita", description: "Tomato, mozzarella, basil", price: "9.50" },
    { category: "Pizzas", name: "Diavola", description: "Tomato, mozzarella, spicy salami", price: "11.00" },
    { category: "Pasta", name: "Tagliatelle al ragù", description: "Fresh egg pasta, slow-cooked beef ragù", price: "13.50" },
    { category: "Desserts", name: "Tiramisù", description: "Made every morning", price: "6.00" },
    { category: "Drinks", name: "Sparkling water", description: "", price: "2.50" },
  ];
  return { kind: "ok", outputText: JSON.stringify({ items }), usage: { inputTokens: 0, outputTokens: 0 } };
}
