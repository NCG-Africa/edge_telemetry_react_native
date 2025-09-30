// import "react-native-get-random-values";
// import { v4 as uuidv4 } from "uuid";

export function generateId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    // return uuidv4();
}
