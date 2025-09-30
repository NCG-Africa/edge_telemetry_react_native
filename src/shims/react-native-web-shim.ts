// Web shim for react-native so Vite doesn't try to parse RN internals.
// Any RN-specific imports should be no-ops in a web build.
// Web shim for react-native so Vite doesn't try to parse RN internals.

export const Platform = {
    OS: "web",
    select: (specs: Record<string, any>) => specs.web ?? specs.default,
};

export default {};
