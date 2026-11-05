# SOQL & SOSL Query Templates

Generated: {TIMESTAMP}
Objects: Case, Vehicle__c

---

## Case

### Base Query

```sql
SELECT Id,
       Case_Category__c,
       PotentialLiability__c,
       ProductId,
       Product__c,
       SLAViolation__c,
       SlaExitDate,
       SlaStartDate,
       Vehicle__c
FROM Case
```

### Child-to-Parent Queries

```sql
-- Lookup to Vehicle__c via Vehicle__c
SELECT Id,
       Vehicle__c
FROM Case
```

### SOSL Template

```sosl
FIND {searchTerm} IN ALL FIELDS
RETURNING Case(Id)
```

---

## Vehicle__c

### Base Query

```sql
SELECT Id
FROM Vehicle__c
```

### Parent-to-Child Queries

```sql
-- Children: Case (via Vehicle__c)
-- Note: Verify 'Cases' is the correct Child Relationship Name
SELECT Id,
    (SELECT Id, Case_Category__c, PotentialLiability__c, Product__c, SLAViolation__c, SlaExitDate
     FROM Cases)
FROM Vehicle__c
```

### SOSL Template

```sosl
FIND {searchTerm} IN ALL FIELDS
RETURNING Vehicle__c(Id)
```

---