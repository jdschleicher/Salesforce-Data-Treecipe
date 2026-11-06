# Entity Relationship Diagram

This diagram illustrates the object model for the Salesforce entities in this Treecipe tree.
Each entity block lists its typed fields (string, number, date, datetime, boolean).
Lookup relationships are shown with `|o--o{` cardinality (optional parent).
MasterDetail relationships are shown with `||--o{` cardinality (required parent).
Cross-tree relationships are excluded — only objects present in this recipe are shown.

Generated: 2026-10-15T09-00-00
Objects: Account, Contact, Visit__c

---

```mermaid
erDiagram
    Account {
        id Id
        string Rating__c
        string Region__c
    }
    Contact {
        id Id
        string Title__c
    }
    Visit__c {
        id Id
        string Notes__c
    }

    Account |o--o{ Contact : "AccountId"
    Contact |o--o{ Visit__c : "Contact__c"
```