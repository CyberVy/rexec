export function are_arrays_strictly_equal(arr1: string[], arr2: string[]) {
    if (arr1.length !== arr2.length) {
        return false
    }
    return arr1.every((element, index) => element === arr2[index])
}

export function are_arrays_content_equal(arr1: string[], arr2: string[]) {
    if (arr1.length !== arr2.length) {
        return false
    }

    const sortedArr1 = [...arr1].sort()
    const sortedArr2 = [...arr2].sort()

    return sortedArr1.every((element, index) => element === sortedArr2[index])
}
