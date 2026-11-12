# Entity Relationship Diagram

This diagram illustrates the object model for the Salesforce entities in this Treecipe tree.
Each entity block lists its typed fields (string, number, date, datetime, boolean).
Lookup relationships are shown with `|o--o{` cardinality (optional parent).
MasterDetail relationships are shown with `||--o{` cardinality (required parent).
Cross-tree relationships are excluded — only objects present in this recipe are shown.

Generated: {TIMESTAMP}
Objects: Account, Contact, Example_Everything__c, MasterDetailMadness__c, MegaMapMadness__c, Opportunity, Order_Item__c, Order__c, Product_Family__c, Product__c, User

---

```mermaid
erDiagram
    Account {
        id Id
        string AccountSource
        string Active__c
        string CustomerPriority__c
        string Jigsaw
        number Number_of_Contacts__c
        date SLAExpirationDate__c
        string SLASerialNumber__c
        string SLA__c
        string ShippingAddress
        string SicDesc
        string Site
        string TickerSymbol
        string UpsellOpportunity__c
    }
    Contact {
        id Id
        string OtherAddress
    }
    Example_Everything__c {
        id Id
        boolean Checkbox__c
        number Currency__c
        date DateOne__c
        datetime DateTimeOne__c
        datetime DateTimeTwo__c
        datetime DateTime__c
        date DateTwo__c
        date Date__c
        string Picklist__c
        string DependentPicklist__c
        string Email__c
        number Formula__c
        string GlobalSuperDependent__c
        string GlobalValuePicklist__c
        string MultiPicklist__c
        number Number__c
        number Percent__c
        string Phone__c
        string PlanetGlobalValuePicklist__c
        string RichTextAreaHtml__c
        string SuperDependent__c
        string TextAreaRich__c
        string Text_Area_Long__c
        string Text__c
        string Time__c
        string Url__c
        string Geolocation__Latitude__s
        string Geolocation__Longitude__s
    }
    MasterDetailMadness__c {
        id Id
    }
    MegaMapMadness__c {
        id Id
        boolean CheckMadness__c
    }
    Opportunity {
        id Id
        string CurrentGenerators__c
        string DeliveryInstallationStatus__c
        string IqScore
        string IsPrivate
        string MainCompetitors__c
        string OrderNumber__c
        string TotalOpportunityQuantity
        string TrackingNumber__c
    }
    Order_Item__c {
        id Id
        number Price__c
        number Qty_L__c
        number Qty_M__c
        number Qty_S__c
    }
    Order__c {
        id Id
        string Status__c
        string Type__c
    }
    Product_Family__c {
        id Id
        string Category__c
        string Description__c
    }
    Product__c {
        id Id
        string Battery__c
        string Category__c
        string Charger__c
        string Description__c
        string Fork__c
        string Frame_Color__c
        string Front_Brakes__c
        string Handlebar_Color__c
        string Level__c
        number MSRP__c
        string Material__c
        string Motor__c
        string Picture_URL__c
        string Rear_Brakes__c
        string Seat_Color__c
        string Waterbottle_Color__c
    }
    User {
        id Id
    }

    Account |o--o{ Account : "ParentId"
    Account |o--o{ Contact : "AccountId"
    Contact |o--o{ Contact : "ReportsToId"
    User |o--o{ Contact : "UserOfAContact_1__c"
    User |o--o{ Contact : "Userlookup_2__c"
    Account |o--o{ Example_Everything__c : "AccountLookup__c"
    Example_Everything__c |o--o{ Example_Everything__c : "Example_Everything_Lookup__c"
    Contact |o--o{ MasterDetailMadness__c : "LU_Contact__c"
    MegaMapMadness__c ||--o{ MasterDetailMadness__c : "MD_MegaMapMadness__c"
    User |o--o{ MegaMapMadness__c : "LUOne_User__c"
    User |o--o{ MegaMapMadness__c : "LUTwo_User__c"
    Account |o--o{ Opportunity : "AccountId"
    Order__c ||--o{ Order_Item__c : "Order__c"
    Product__c |o--o{ Order_Item__c : "Product__c"
    Account |o--o{ Order__c : "Account__c"
    Product_Family__c |o--o{ Product__c : "Product_Family__c"
```