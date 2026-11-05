# Entity Relationship Diagram

This diagram illustrates the object model for the Salesforce entities in this Treecipe tree.
Each entity block lists its typed fields (string, number, date, datetime, boolean).
Lookup relationships are shown with `|o--o{` cardinality (optional parent).
MasterDetail relationships are shown with `||--o{` cardinality (required parent).
Cross-tree relationships are excluded — only objects present in this recipe are shown.

Generated: {TIMESTAMP}
Objects: Product2

---

```mermaid
erDiagram
    Product2 {
        id Id
        number Cost__c
        number Current_Inventory__c
        number Lifespan_Months__c
        number Maintenance_Cycle__c
        boolean Replacement_Part__c
        string StockKeepingUnit
        string Warehouse_SKU__c
    }

```