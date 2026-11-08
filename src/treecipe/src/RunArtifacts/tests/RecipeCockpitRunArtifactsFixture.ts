import * as fs from 'fs';
import * as path from 'path';

import { IRecipeCockpitRunArtifactsLocation, RECIPE_COCKPIT_RUN_ARTIFACTS_FOLDER_NAME } from '../RecipeCockpitRunArtifacts';

export const FIXTURE_RUN_FOLDER_NAME = 'recipe-2026-10-27T10-00-00';
export const FIXTURE_TREE_FOLDER_NAME = 'Account-thru-Contact';

// <workspace>/treecipe/GeneratedRecipes/<run>/<tree>, MADE ON DISK, AND THE LOCATION OF ITS RunArtifacts FOLDER
export function makeTreeRunArtifactsLocation(workspaceRoot: string,
                                                runFolderName: string = FIXTURE_RUN_FOLDER_NAME,
                                                treeFolderName: string = FIXTURE_TREE_FOLDER_NAME): IRecipeCockpitRunArtifactsLocation {

    const location = buildTreeRunArtifactsLocation(workspaceRoot, runFolderName, treeFolderName);
    fs.mkdirSync(location.treeFolderPath, { recursive: true });
    return location;

}

// THE SAME LOCATION, NOTHING MADE: FOR A PATH BUILT AND NEVER WRITTEN
export function buildTreeRunArtifactsLocation(workspaceRoot: string,
                                                runFolderName: string = FIXTURE_RUN_FOLDER_NAME,
                                                treeFolderName: string = FIXTURE_TREE_FOLDER_NAME): IRecipeCockpitRunArtifactsLocation {

    const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
    const treeFolderPath = path.join(resolvedWorkspaceRoot, 'treecipe', 'GeneratedRecipes', runFolderName, treeFolderName);

    return {
        workspaceRoot: resolvedWorkspaceRoot,
        treeFolderPath: treeFolderPath,
        folderPath: path.join(treeFolderPath, RECIPE_COCKPIT_RUN_ARTIFACTS_FOLDER_NAME)
    };

}
