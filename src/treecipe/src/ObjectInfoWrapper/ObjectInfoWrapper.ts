import { RecipeFileOutput, RelationshipTree } from "../RelationshipService/RelationshipService";
import { SalesforceApiName } from "../RecipeService/SalesforceApiName";
import { ObjectInfo } from "./ObjectInfo";

export class ObjectInfoWrapper {

  ObjectToObjectInfoMap:Record<string, ObjectInfo> = {};

  RecipeFiles?: RecipeFileOutput[];

  RelationshipTrees?: RelationshipTree[];

  // ABSENT UNLESS A NAME WAS REFUSED, SO AN ORDINARY RUN SERIALIZES EXACTLY AS BEFORE
  SkippedObjectApiNames?: string[];

  /*
    The one way an object enters the map -- the directory walk and a lookup's parent alike -- so it
    is the one place an object name is checked (#164). Every recipe writer reads its object names
    from this map: initiateRecipeByObjectName, RelationshipService's grouping and comments, the
    generated folder names and the objects wrapper the Recipe Cockpit reads. A refused name is
    recorded rather than added, and the caller must not index the map with it.
  */
  public addKeyToObjectInfoMap(objectApiName: string): boolean {

    if ( !SalesforceApiName.isApiName(objectApiName) ) {

      this.SkippedObjectApiNames ??= [];
      if ( !this.SkippedObjectApiNames.includes(objectApiName) ) {
        this.SkippedObjectApiNames.push(objectApiName);
      }
      return false;

    }

    // WITH THE ITERATION OF OBJECTS AND THE NEED TO ADD REFERENCES BASED ON LOOKUPS
    // AN OBJECT KEY COULD BE ADDED DUE TO A LOOKUP RELATIONSHIP BEFORE AN OBJECT IS ITERATED OVER
    if ( !Object.prototype.hasOwnProperty.call(this.ObjectToObjectInfoMap, objectApiName) ) {
      this.ObjectToObjectInfoMap[objectApiName] = new ObjectInfo(objectApiName);
    }

    return true;

  }


}



