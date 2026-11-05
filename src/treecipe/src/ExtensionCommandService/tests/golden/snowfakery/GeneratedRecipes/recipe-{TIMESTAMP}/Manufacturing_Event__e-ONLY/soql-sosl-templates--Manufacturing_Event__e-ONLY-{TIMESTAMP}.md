# SOQL & SOSL Query Templates

Generated: {TIMESTAMP}
Objects: Manufacturing_Event__e

---

## Manufacturing_Event__e

### Base Query

```sql
SELECT Id,
       Order_Id__c,
       Status__c
FROM Manufacturing_Event__e
```

### SOSL Template

```sosl
FIND {searchTerm} IN ALL FIELDS
RETURNING Manufacturing_Event__e(Id, Order_Id__c, Status__c)
```

---