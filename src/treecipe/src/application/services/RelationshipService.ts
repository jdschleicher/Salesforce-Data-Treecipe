import { FieldInfo } from "../../domain/entities/FieldInfo";
import { ObjectInfo } from "../../domain/entities/ObjectInfo";
// import { RelationshipDetail, RelationshipBreakdown } from "../../domain/entities/RelationshipDetail";
// import { ObjectRelationshipWrapper } from "../../domain/entities/ObjectInfoWrapper";

export class RelationshipService {

    // updateRelationshipDetail(): RelationshipDetail {
    //     if ( !(this.objects.get(fieldInfo.referenceTo).relationshipDetail)) {
    //         this.objects.get(fieldInfo.referenceTo).relationshipDetail = new RelationshipDetail();
    //         this.objects.get(fieldInfo.referenceTo).relationshipDetail.relationshipBreakdown = new RelationshipBreakdown();
    //       } 
    //       let lookupRelationshipBreakdown = this.objects.get(fieldInfo.referenceTo).relationshipDetail
  
    //       if (!(lookupRelationshipBreakdown.childRelationshipBreakdown.objectToReferencedFields)) {
  
    //         let fieldReferences = [];
    //         fieldReferences.push(fieldInfo);
    //         lookupRelationshipBreakdown.childRelationshipBreakdown.objectToReferencedFields = new Map<string, FieldInfo[]>();
    //         lookupRelationshipBreakdown.childRelationshipBreakdown.objectToReferencedFields[fieldInfo.objectName] = fieldReferences;
  
    //       } else {
  
    //         lookupRelationshipBreakdown.childRelationshipBreakdown.objectToReferencedFields[fieldInfo.objectName].add(fieldInfo);
  
    //       }
    //       let totalFieldReferencesByOneObject = lookupRelationshipBreakdown[fieldInfo.objectName].childRelationshipBreakdown.count;
    //       if (lookupRelationshipBreakdown.maxTotalCountReferencedByOneObject < totalFieldReferencesByOneObject ) {
    //         lookupRelationshipBreakdown.maxTotalCountReferencedByOneObject = totalFieldReferencesByOneObject;
    //       } 
  
    //       let lookupRelationshipLevel = this.objects.get(fieldInfo.referenceTo).relationshipDetail.relationshipLevel;
    //       let currentObjectRelationshipLevel = this.objects.get(fieldInfo.objectName).relationshipDetail.relationshipLevel;
    //       if ( currentObjectRelationshipLevel >= lookupRelationshipLevel ) {
    //         let newRelationshipLevel = ( lookupRelationshipLevel - 1 );
    //         this.objects.get(fieldInfo.objectName).relationshipDetail.relationshipLevel = newRelationshipLevel;
    //       }
    // }

    // buildNewRelationshipDetail(): RelationshipDetail {

    //     let objectRelationshipTracker = new RelationshipDetail();
    //     objectRelationshipTracker.relationshipBreakdown = new RelationshipBreakdown();
    //     return objectRelationshipTracker;

    // }

    // public buildRelationshipTrackerByObject(objectName: string, objectTracker: ObjectRelationshipWrapper ) {
    
        // if ( !(objectTracker.objects.has(objectName)) ) {
    
        //     let relationshipTracker = new RelationshipDetail();
        //     relationshipTracker.relationshipLevel = 1
        //     relationshipTracker.relationshipBreakdown = new RelationshipBreakdown();
            
        // }
    
    // }

   

}