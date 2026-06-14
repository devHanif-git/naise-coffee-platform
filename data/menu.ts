import type { Category, Product } from "@/types/menu";
import { images } from "@/constants/images";

export const categories: Category[] = [
  { type: "coffee", name: "Coffee" },
  { type: "non_coffee", name: "Non Coffee" },
  { type: "matcha", name: "Matcha" },
];

// Shared add-on sets per category.
const coffeeAddons = [
  { id: "extra-shot", name: "Extra Shot", price: 200 },
  { id: "oat-milk", name: "Oat Milk", price: 250 },
  { id: "vanilla", name: "Vanilla Syrup", price: 150 },
  { id: "caramel", name: "Caramel Syrup", price: 150 },
];

const nonCoffeeAddons = [
  { id: "pearls", name: "Pearls", price: 150 },
  { id: "extra-syrup", name: "Extra Syrup", price: 150 },
];

const matchaAddons = [
  { id: "oat-milk", name: "Oat Milk", price: 250 },
  { id: "extra-matcha", name: "Extra Matcha", price: 300 },
];

// How many add-ons a customer may pick (CMS-driven; mocked here).
const MAX_ADDONS = 3;

// Regular + Large sizes; prices in sen (1 MYR = 100 sen). Large is +RM2.00.
function size(price: number) {
  return [
    { id: "regular", name: "Regular", price },
    { id: "large", name: "Large", price: price + 200 },
  ];
}

const productList: Product[] = [
  {
    id: "naise-signature-latte",
    slug: "naise-signature-latte",
    name: "Naise Signature Latte",
    description: "Smooth. Bold. Naise.",
    category: "coffee",
    image: images.coffeeWithLogo,
    sizes: size(1290),
    addons: coffeeAddons,
    isBestSeller: true,
  },
  {
    id: "spanish-latte",
    slug: "spanish-latte",
    name: "Spanish Latte",
    description: "Sweet & creamy.",
    category: "coffee",
    image: images.coffeeWithLogo,
    sizes: size(1390),
    addons: coffeeAddons,
  },
  {
    id: "americano",
    slug: "americano",
    name: "Americano",
    description: "Bold and classic.",
    category: "coffee",
    image: images.coffeeWithLogo,
    price: 990,
    addons: coffeeAddons,
  },
  {
    id: "caramel-macchiato",
    slug: "caramel-macchiato",
    name: "Caramel Macchiato",
    description: "Rich. Sweet. Balanced.",
    category: "coffee",
    image: images.coffeeWithLogo,
    sizes: size(1390),
    addons: coffeeAddons,
    isBestSeller: true,
  },
  {
    id: "vanilla-latte",
    slug: "vanilla-latte",
    name: "Vanilla Latte",
    description: "Smooth vanilla vibe.",
    category: "coffee",
    image: images.coffeeWithLogo,
    sizes: size(1290),
    addons: coffeeAddons,
    isBestSeller: true,
  },
  {
    id: "mocha",
    slug: "mocha",
    name: "Mocha",
    description: "Chocolate meets coffee.",
    category: "coffee",
    image: images.coffeeWithLogo,
    sizes: size(1390),
    addons: coffeeAddons,
  },
  {
    id: "iced-chocolate",
    slug: "iced-chocolate",
    name: "Iced Chocolate",
    description: "Rich and velvety.",
    category: "non_coffee",
    image: images.coffeeWithLogo,
    sizes: size(1190),
    addons: nonCoffeeAddons,
  },
  {
    id: "brown-sugar-milk",
    slug: "brown-sugar-milk",
    name: "Brown Sugar Milk",
    description: "Sweet and comforting.",
    category: "non_coffee",
    image: images.coffeeWithLogo,
    sizes: size(1290),
    addons: nonCoffeeAddons,
    isNew: true,
  },
  {
    id: "matcha-latte",
    slug: "matcha-latte",
    name: "Matcha Latte",
    description: "Earthy and smooth.",
    category: "matcha",
    image: images.coffeeWithLogo,
    sizes: size(1490),
    addons: matchaAddons,
  },
  {
    id: "strawberry-matcha",
    slug: "strawberry-matcha",
    name: "Strawberry Matcha",
    description: "Fruity meets earthy.",
    category: "matcha",
    image: images.coffeeWithLogo,
    sizes: size(1690),
    addons: matchaAddons,
    isNew: true,
  },
];

// Apply the shared add-on limit unless a product overrides it.
export const products: Product[] = productList.map((p) => ({
  maxAddons: MAX_ADDONS,
  ...p,
}));

export function getProduct(slug: string): Product | undefined {
  return products.find((p) => p.slug === slug);
}

export function getProductsByCategory(category: Product["category"]): Product[] {
  return products.filter((p) => p.category === category);
}

export function getBestSellers(): Product[] {
  return products.filter((p) => p.isBestSeller);
}

// Lowest price to show as the product's "from" price. Falls back to the flat
// `price` when a product has no sizes; 0 if neither is set.
export function getBasePrice(product: Product): number {
  if (product.sizes && product.sizes.length > 0) {
    return Math.min(...product.sizes.map((s) => s.price));
  }
  return product.price ?? 0;
}
