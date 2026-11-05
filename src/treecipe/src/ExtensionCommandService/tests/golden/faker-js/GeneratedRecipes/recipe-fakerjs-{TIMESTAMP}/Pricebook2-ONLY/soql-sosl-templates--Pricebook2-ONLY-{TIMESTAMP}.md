# SOQL & SOSL Query Templates

Generated: {TIMESTAMP}
Objects: Pricebook2

---

## Pricebook2

### Base Query

```sql
SELECT Id,
       Description,
       IsActive,
       IsStandard,
       Name
FROM Pricebook2
```

### SOSL Template

```sosl
FIND {searchTerm} IN ALL FIELDS
RETURNING Pricebook2(Id)
```

---