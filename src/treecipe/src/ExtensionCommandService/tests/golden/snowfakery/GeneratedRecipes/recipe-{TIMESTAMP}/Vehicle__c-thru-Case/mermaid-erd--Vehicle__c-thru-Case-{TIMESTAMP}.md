# Entity Relationship Diagram

This diagram illustrates the object model for the Salesforce entities in this Treecipe tree.
Each entity block lists its typed fields (string, number, date, datetime, boolean).
Lookup relationships are shown with `|o--o{` cardinality (optional parent).
MasterDetail relationships are shown with `||--o{` cardinality (required parent).
Cross-tree relationships are excluded — only objects present in this recipe are shown.

Generated: {TIMESTAMP}
Objects: Case, Vehicle__c

---

```mermaid
erDiagram
    Case {
        id Id
        string Case_Category__c
        string PotentialLiability__c
        string Product__c
        string SLAViolation__c
        string SlaExitDate
        string SlaStartDate
    }
    Vehicle__c {
        id Id
    }

    Vehicle__c |o--o{ Case : "Vehicle__c"
```