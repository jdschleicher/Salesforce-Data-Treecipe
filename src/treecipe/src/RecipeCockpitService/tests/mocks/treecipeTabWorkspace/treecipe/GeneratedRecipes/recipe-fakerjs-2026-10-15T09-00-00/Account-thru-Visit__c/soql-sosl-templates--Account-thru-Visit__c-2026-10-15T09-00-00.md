# SOQL & SOSL Query Templates

Generated: 2026-10-15T09-00-00
Objects: Account, Contact, Visit__c

---

## Account

### Base Query

```sql
SELECT Id,
       Rating__c,
       Region__c
FROM Account
```

### Parent-to-Child Queries

```sql
-- Children: Contact (via AccountId)
-- Note: Verify 'Contacts' is the correct Child Relationship Name
SELECT Id,
    (SELECT Id, Title__c
     FROM Contacts)
FROM Account
```

### Record Type Filtered Queries

```sql
-- Record Type: Business
SELECT Id,
       Rating__c,
       Region__c
FROM Account
WHERE RecordType.DeveloperName = 'Business'
```

```sql
-- Record Type: Partner
SELECT Id,
       Rating__c,
       Region__c
FROM Account
WHERE RecordType.DeveloperName = 'Partner'
```

### SOSL Template

```sosl
FIND {searchTerm} IN ALL FIELDS
RETURNING Account(Id, Region__c)
```

---

## Contact

### Base Query

```sql
SELECT Id,
       AccountId,
       Title__c
FROM Contact
```

### Child-to-Parent Queries

```sql
-- Lookup to Account via AccountId
SELECT Id,
       AccountId,
       Account.Rating__c,
       Account.Region__c
FROM Contact
```

### Parent-to-Child Queries

```sql
-- Children: Visit__c (via Contact__c)
-- Note: Verify 'Visits__r' is the correct Child Relationship Name
SELECT Id,
    (SELECT Id, Notes__c
     FROM Visits__r)
FROM Contact
```

### SOSL Template

```sosl
FIND {searchTerm} IN ALL FIELDS
RETURNING Contact(Id, Title__c)
```

---

## Visit__c

### Base Query

```sql
SELECT Id,
       Contact__c,
       Notes__c
FROM Visit__c
```

### Child-to-Parent Queries

```sql
-- Lookup to Contact via Contact__c
SELECT Id,
       Contact__c,
       Contact__r.Title__c
FROM Visit__c
```

### SOSL Template

```sosl
FIND {searchTerm} IN ALL FIELDS
RETURNING Visit__c(Id, Notes__c)
```

---