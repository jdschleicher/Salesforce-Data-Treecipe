import { ObjectInfoWrapper } from "../ObjectInfoWrapper";

import * as matchers from "jest-extended";
expect.extend(matchers);

describe('addObjectInfoKey', () => {

  test('given a new string key is added to an existing ObjectInfo Map the ObjectInfo map is updated with the new key', () => {
  
    const newTestKey:string = "Account";

    let objectInfoWrapper = new ObjectInfoWrapper();
    objectInfoWrapper.addKeyToObjectInfoMap(newTestKey);

    // SHOULD BE ONLY 1 KEY/VALUE PAIR
    for ( const objectKey in objectInfoWrapper.ObjectToObjectInfoMap ) {
      expect(objectKey).toBe(newTestKey);
    }

  });

});


describe('addKeyToObjectInfoMap refuses an object name that is not a Salesforce api name (#164)', () => {

  test.each([
    ['a line feed', 'Evil\n- object: Injected__c'],
    ['a carriage return', 'Evil\r- object: Injected__c'],
    ['a line separator', 'Evil - object: Injected__c'],
    ['a path traversal', '../Evil'],
    ['a space', 'Evil Object'],
    ['a leading digit', '1Evil'],
    ['an empty name', ''],
    ['a non-string', undefined]
  ])('given %s, it adds no key, returns false and records the name', (unusedDescription, hostileObjectName) => {

    const objectInfoWrapper = new ObjectInfoWrapper();

    expect(objectInfoWrapper.addKeyToObjectInfoMap(hostileObjectName as string)).toBeFalse();
    expect(Object.keys(objectInfoWrapper.ObjectToObjectInfoMap)).toEqual([]);
    expect(objectInfoWrapper.SkippedObjectApiNames).toEqual([hostileObjectName]);

  });

  test('records a refused name once however often it is offered', () => {

    const objectInfoWrapper = new ObjectInfoWrapper();
    objectInfoWrapper.addKeyToObjectInfoMap('Evil\nName');
    objectInfoWrapper.addKeyToObjectInfoMap('Evil\nName');

    expect(objectInfoWrapper.SkippedObjectApiNames).toEqual(['Evil\nName']);

  });

  test.each(['Account', 'ns__Thing__c', 'Manufacturing_Event__e', 'constructor', 'toString'])('given %s, it adds the key and returns true', (objectName) => {

    const objectInfoWrapper = new ObjectInfoWrapper();

    expect(objectInfoWrapper.addKeyToObjectInfoMap(objectName)).toBeTrue();
    expect(Object.prototype.hasOwnProperty.call(objectInfoWrapper.ObjectToObjectInfoMap, objectName)).toBeTrue();
    expect(objectInfoWrapper.ObjectToObjectInfoMap[objectName].ApiName).toBe(objectName);

  });

  test('keeps an existing entry when its name is offered again', () => {

    const objectInfoWrapper = new ObjectInfoWrapper();
    objectInfoWrapper.addKeyToObjectInfoMap('Account');
    const existingObjectInfo = objectInfoWrapper.ObjectToObjectInfoMap['Account'];

    expect(objectInfoWrapper.addKeyToObjectInfoMap('Account')).toBeTrue();
    expect(objectInfoWrapper.ObjectToObjectInfoMap['Account']).toBe(existingObjectInfo);

  });

  test('serializes exactly as before when no name was refused', () => {

    const objectInfoWrapper = new ObjectInfoWrapper();
    objectInfoWrapper.addKeyToObjectInfoMap('Account');

    expect(objectInfoWrapper).not.toHaveProperty('SkippedObjectApiNames');
    expect(JSON.stringify(objectInfoWrapper)).toBe('{"ObjectToObjectInfoMap":{"Account":{"ApiName":"Account"}}}');

  });

});
