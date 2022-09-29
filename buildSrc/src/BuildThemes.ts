import { resolvePaths, StringDictionary, walkDir } from "doki-build-source";
import path from "path";
import xmlParser from "xml2js";
import * as fs from "fs";
import deepClone from "lodash/cloneDeep";

const xmlBuilder = new xmlParser.Builder({
  renderOpts: {
    pretty: false,
  },
});

const toXml = (xml1: string): Promise<any> =>
  xmlParser.parseStringPromise(xml1);

const { appTemplatesDirectoryPath } = resolvePaths(__dirname);

type IconMapping = {
  iconName: string;
  sizes: number[];
};

const iconsDir = path.resolve(__dirname, "..", "..", "icons");
const exportedIconsDir = path.join(iconsDir, "exported");
const generatedIconsDir = path.join(iconsDir, "generated");

console.log("Preparing to generate icons.");

function extractGuts(svgGuy: any) {
  const otherKeys = Object.keys(svgGuy).filter((key) => key !== "$");
  const gutsToGroup = otherKeys
    .map((key) => [key, svgGuy[key]])
    .reduce((accum, [key, value]) => {
      accum[key] = value;
      return accum;
    }, {} as StringDictionary<any>);
  otherKeys.forEach((key) => delete svgGuy[key]);
  return gutsToGroup;
}

type Anchor =
  | "UPPER_RIGHT"
  | "UPPER_LEFT"
  | "UPPER"
  | "MIDDLE_LEFT"
  | "MIDDLE_RIGHT"
  | "MIDDLE"
  | "LOWER_LEFT"
  | "LOWER"
  | "LOWER_RIGHT";

function getPosition(svgPosition: Anchor): { x: number; y: number } {
  switch (svgPosition) {
    case "LOWER_LEFT":
      return { x: 0, y: 24 };
    case "LOWER_RIGHT":
      return { x: 24, y: 24 };
    case "LOWER":
      return { x: 12, y: 24 };
    case "MIDDLE_LEFT":
      return { x: 0, y: 12 };
    case "MIDDLE":
      return { x: 12, y: 12 };
    case "MIDDLE_RIGHT":
      return { x: 24, y: 12 };
    default:
    case "UPPER_LEFT":
      return { x: 0, y: 0 };
    case "UPPER":
      return { x: 12, y: 0 };
    case "UPPER_RIGHT":
      return { x: 24, y: 0 };
  }
}

walkDir(exportedIconsDir)
  .then(async (icons) => {
    const svgNameToPatho = icons.reduce((accum, generatedIconPath) => {
      const svgName = generatedIconPath.substring(exportedIconsDir.length + 1);
      accum[svgName] = generatedIconPath;
      return accum;
    }, {} as StringDictionary<string>);

    const layeredIcons: {
      name: string;
      position?: Anchor;
      scale?: number;
    }[][] = JSON.parse(
      fs.readFileSync(
        path.join(appTemplatesDirectoryPath, "layered.icons.mappings.json"),
        {
          encoding: "utf-8",
        }
      )
    );

    for (const iconLayers of layeredIcons) {
      const { fileName, layeredSVG } = await iconLayers.reduce<
        Promise<{ fileName: string; layeredSVG: any }>
      >(
        (currentSVGPromise, nextSVGSpec) =>
          currentSVGPromise.then(async (currentSVG) => {
            const svgName = nextSVGSpec.name;
            const exportedPath = svgNameToPatho[svgName];
            if (!exportedPath) {
              throw new Error(`Hey silly, you forgot to export ${svgName}`);
            }
            const svgAsXML = await toXml(
              fs.readFileSync(exportedPath, { encoding: "utf-8" })
            );
            const fileName = svgName.substring(0, svgName.lastIndexOf(".svg"));
            if (!currentSVG.layeredSVG) {
              const svgGuy = svgAsXML.svg;
              const groupedGuts = extractGuts(svgGuy);
              svgGuy.g = [groupedGuts];
              return {
                fileName,
                layeredSVG: svgAsXML,
              };
            } else {
              currentSVG.fileName += `_${fileName}`;
              const nonBaseGuts = extractGuts(svgAsXML.svg);
              const svgPosition = nextSVGSpec.position;
              if (svgPosition) {
                const scale = 0.5;
                const { x, y } = getPosition(svgPosition);
                nonBaseGuts.$ = {
                  ...nonBaseGuts.$,
                  transform: `scale(${scale} ${scale}) translate(${x} ${y})`,
                };
              }
              currentSVG.layeredSVG.svg.g.push(nonBaseGuts);
              return currentSVG;
            }
          }),
        Promise.resolve({ fileName: "", layeredSVG: undefined })
      );

      fs.writeFileSync(
        path.join(generatedIconsDir, `${fileName}.svg`),
        xmlBuilder.buildObject(layeredSVG),
        { encoding: "utf-8" }
      );
    }

    const jetbrainsMappings: IconMapping[] = JSON.parse(
      fs.readFileSync(
        path.join(appTemplatesDirectoryPath, "jetbrains.mappings.json"),
        {
          encoding: "utf-8",
        }
      )
    );

    for (const iconMapping of jetbrainsMappings) {
      const iconName = iconMapping.iconName;
      const svgPath =
        svgNameToPatho[iconName] || path.join(generatedIconsDir, iconName);
      if (!fs.existsSync(svgPath)) {
        throw new Error(`Hey silly, you forgot to export ${iconName}`);
      }

      const svgAsXML = await toXml(
        fs.readFileSync(svgPath, { encoding: "utf-8" })
      );
      iconMapping.sizes.forEach((iconSize) => {
        const workingCopy = deepClone(svgAsXML);
        const fileNameWithoutExtension = iconName.substring(
          0,
          iconName.length - 4
        );
        const newFileName = `${fileNameWithoutExtension}_${iconSize}x${iconSize}.svg`;
        const generatedFilePath = path.join(generatedIconsDir, newFileName);
        workingCopy.svg.$.width = `${iconSize}px`;
        workingCopy.svg.$.height = `${iconSize}px`;

        fs.writeFileSync(
          generatedFilePath,
          xmlBuilder.buildObject(workingCopy),
          { encoding: "utf-8" }
        );
      });
    }
  })
  .then(() => {
    console.log("Icon Generation Complete!");
  });
