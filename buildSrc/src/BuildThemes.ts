import {resolvePaths, StringDictionary, walkDir} from "doki-build-source";
import path from "path";
import xmlParser from "xml2js";
import * as fs from "fs";
import deepClone from "lodash/cloneDeep";
import builder from "xmlbuilder";

const parser = new xmlParser.Parser({
  explicitChildren: true,
  mergeAttrs: false,
  preserveChildrenOrder: true,
});

const toXml = (xml1: string): Promise<any> => parser.parseStringPromise(xml1);

const {appTemplatesDirectoryPath, masterTemplateDirectoryPath} = resolvePaths(__dirname);

type IconMapping = {
  iconName: string;
  sizes: number[];
};

const iconsDir = path.resolve(__dirname, "..", "..", "icons");
const exportedIconsDir = path.join(iconsDir, "exported");
const generatedIconsDir = path.join(iconsDir, "generated");

console.log("Preparing to generate icons.");

function constructSVG(root: any, children: any[]) {
  if (!children) {
    return;
  }

  for (const child of children) {
    const childNode = root.ele(child["#name"], child.$ || {});
    constructSVG(childNode, child.$$);
  }
}

function buildXml(workingCopy: any): string {
  const svg = workingCopy.svg;
  const root = builder.create(svg["#name"]);

  Object.entries(svg.$).forEach(([attributeKey, attributeValue]) =>
    root.att(attributeKey, attributeValue)
  );

  constructSVG(root, svg.$$);

  return root.end({pretty: true});
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

const defaultSvgSize = 24;

function getPosition(
  svgPosition: Anchor,
  scale: number | XY
): { x: number; y: number } {
  const usableScale: number = typeof scale === 'number' ?
    scale : Math.max(scale.x || defaultSvgSize, scale.y || defaultSvgSize);
  const scaledSVG = defaultSvgSize * usableScale;
  const delta = defaultSvgSize - scaledSVG;
  switch (svgPosition) {
    case "LOWER_LEFT":
      return {x: 0, y: delta};
    case "LOWER_RIGHT":
      return {
        x: delta,
        y: delta,
      };
    case "LOWER":
      return {x: delta / 2, y: delta};
    case "MIDDLE_LEFT":
      return {x: 0, y: delta / 2};
    case "MIDDLE":
      return {x: delta / 2, y: delta / 2};
    case "MIDDLE_RIGHT":
      return {x: delta, y: delta / 2};
    default:
    case "UPPER_LEFT":
      return {x: 0, y: 0};
    case "UPPER":
      return {x: delta / 2, y: 0};
    case "UPPER_RIGHT":
      return {x: delta, y: 0};
  }
}

function addFill(nonBaseGuts: StringDictionary<any>, fillProvider: (color: string) => string) {
  if (!nonBaseGuts) {
    return;
  }

  if (!nonBaseGuts.$) {
    nonBaseGuts.$ = {};
  }
  nonBaseGuts.$.fill = fillProvider(nonBaseGuts.$.fill);

  (nonBaseGuts.$$ || []).forEach((item: any) => {
    addFill(item, fillProvider);
  });
}

type XY = {
  x?: number;
  y?: number;
};
type LayeredSVGSpec = {
  name: string;
  displayName?: string;
  position?: Anchor;
  margin?: XY;
  fill?: string | StringDictionary<string>;
  scale?: number | XY;
  newName?: string;
  includeName?: boolean;
};

const namedColors: StringDictionary<string> = JSON.parse(fs.readFileSync(
  path.join(masterTemplateDirectoryPath, 'base.colors.template.json'), {
    encoding: 'utf-8',
  }
)).colors

const hexToNamedIconColor: StringDictionary<string> = JSON.parse(fs.readFileSync(
  path.join(appTemplatesDirectoryPath, 'icon.palette.template.json'), {
    encoding: 'utf-8',
  }
))
const namedIconColorToHex = Object.entries(hexToNamedIconColor)
  .reduce<StringDictionary<string>>((accum, [hex, namedColor]) => {
    accum[namedColor] = hex;
    return accum;
  }, {})

function processSVG(svgAsXML: any, nextSVGSpec: LayeredSVGSpec) {
  const nonBaseGuts = {
    $: {},
    "#name": "g",
    $$: svgAsXML.svg.$$,
  };
  const svgPosition = nextSVGSpec.position;
  if (svgPosition) {
    const {x: scaleX, y: scaleY} =
      typeof nextSVGSpec.scale === 'number' || nextSVGSpec.scale === undefined ?
        {x: nextSVGSpec.scale, y: nextSVGSpec.scale} :
        {x: nextSVGSpec.scale.x, y: nextSVGSpec.scale.y};
    const defaultSVGSize = 0.5;
    const {x, y} = getPosition(svgPosition, nextSVGSpec.scale || defaultSVGSize);
    nonBaseGuts.$ = {
      ...nonBaseGuts.$,
      transform: `translate(${x + (nextSVGSpec.margin?.x || 0)} ${
        y + (nextSVGSpec.margin?.y || 0)
      }) scale(${scaleX || defaultSVGSize} ${scaleY || defaultSVGSize})`,
    };
  }

  const fill = nextSVGSpec.fill;
  const fillProvider: (color: string) => string = typeof fill === 'string' ?
    () => hexToNamedIconColor[fill] || namedIconColorToHex[fill] || fill :
    (color) => {
      if (typeof fill === 'object') {
        const namedColorMapping = hexToNamedIconColor[color];
        const newColor = fill[namedColorMapping];
        if (namedColorMapping && newColor) {
          return newColor.startsWith('#') ?
            newColor :
            namedIconColorToHex[newColor] || color
        }
      }
      return color
    }
  if (fill) {
    addFill(nonBaseGuts, fillProvider);
  }
  return nonBaseGuts;
}

type LayeredIconResult = { fileName: string; layeredSVG: any, displayName: string };
walkDir(exportedIconsDir)
  .then(async (icons) => {
    const svgNameToPatho = icons.reduce((accum, generatedIconPath) => {
      const svgName = generatedIconPath.substring(exportedIconsDir.length + 1);
      accum[svgName] = generatedIconPath;
      return accum;
    }, {} as StringDictionary<string>);

    const layeredIcons: LayeredSVGSpec[][] = JSON.parse(
      fs.readFileSync(
        path.join(appTemplatesDirectoryPath, "layered.icons.mappings.json"),
        {
          encoding: "utf-8",
        }
      )
    );

    for (const iconLayers of layeredIcons) {
      const {fileName, layeredSVG, displayName} = await iconLayers.reduce<Promise<LayeredIconResult>>(
        (currentSVGPromise, nextSVGSpec) =>
          currentSVGPromise.then(async (currentSVG: LayeredIconResult) => {
            const svgName = nextSVGSpec.name;
            const exportedPath = svgNameToPatho[svgName];
            if (!exportedPath) {
              throw new Error(`Hey silly, you forgot to export ${svgName}`);
            }
            const svgAsXML = await toXml(
              fs.readFileSync(exportedPath, {encoding: "utf-8"})
            );
            const fileName = svgName.substring(0, svgName.lastIndexOf(".svg"));
            const resolvedFileName = nextSVGSpec.newName || fileName;
            if (!currentSVG.layeredSVG) {
              const svgGuy = svgAsXML.svg;
              svgGuy.$$ = [processSVG(svgAsXML, nextSVGSpec)];
              return {
                fileName: resolvedFileName,
                layeredSVG: svgAsXML,
                displayName: nextSVGSpec.displayName || currentSVG.displayName
              } as LayeredIconResult;
            } else {
              currentSVG.displayName = nextSVGSpec.displayName || currentSVG.displayName
              if (nextSVGSpec.includeName !== false) {
                currentSVG.fileName += `_${resolvedFileName}`;
              }
              const nonBaseGuts = processSVG(svgAsXML, nextSVGSpec);

              currentSVG.layeredSVG.svg.$$.push(nonBaseGuts);
              return currentSVG;
            }
          }),
        Promise.resolve<LayeredIconResult>({fileName: "", layeredSVG: undefined, displayName: ""})
      );

      fs.writeFileSync(
        path.join(generatedIconsDir, `${displayName || fileName}.svg`),
        buildXml(layeredSVG),
        {encoding: "utf-8"}
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
        fs.readFileSync(svgPath, {encoding: "utf-8"})
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

        fs.writeFileSync(generatedFilePath, buildXml(workingCopy), {
          encoding: "utf-8",
        });
      });
    }
  })
  .then(() => {
    console.log("Icon Generation Complete!");
  });
