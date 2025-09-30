// import { v4 as uuidv4 } from "uuid";

export function generateId() {
    // return uuidv4();

    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}
