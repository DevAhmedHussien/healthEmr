-- Never written to and never read. It duplicated pharmacy_products, which is
-- the table the dispensing path actually uses, and having both meant "what does
-- this pharmacy stock" had two plausible answers and one right one.
DROP TABLE IF EXISTS "pharmacy_kits";
