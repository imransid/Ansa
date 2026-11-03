// A made-up caller for the practice phone (step 55, development only). The
// number is who is calling: core keeps one conversation per number, and a
// number that called before keeps the name it first called with. So each
// visit of the page, and each "New caller", gets a number of its own.

// Bangladesh's mobile operators: 013 to 019.
const FIRST_OPERATOR = 3;
const OPERATORS = 7;

// A Bangladeshi-looking mobile number with random digits ("+880 1712 345678").
export function madeUpCallerNumber(): string {
  const operator = FIRST_OPERATOR + Math.floor(Math.random() * OPERATORS);
  let digits = "";
  for (let count = 0; count < 8; count++) {
    digits += Math.floor(Math.random() * 10);
  }
  return `+880 1${operator}${digits.slice(0, 2)} ${digits.slice(2)}`;
}
