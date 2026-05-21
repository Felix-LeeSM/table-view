pub type MongoshCompletionVocabulary = &'static str;

pub fn completion_vocabulary() -> MongoshCompletionVocabulary {
    PACKED_VOCABULARY
}

#[cfg(test)]
const GROUP_SEPARATOR: &str = "\u{1f}";

#[rustfmt::skip]
const PACKED_VOCABULARY: &str = "$all\n$and\n$bitsAllClear\n$bitsAllSet\n$bitsAnyClear\n$bitsAnySet\n$elemMatch\n$eq\n$exists\n$expr\n$geoIntersects\n$geoWithin\n$gt\n$gte\n$in\n$jsonSchema\n$lt\n$lte\n$mod\n$ne\n$near\n$nearSphere\n$nin\n$nor\n$not\n$or\n$regex\n$size\n$text\n$type\n$where\u{1f}$\n$elemMatch\n$meta\n$slice\u{1f}$\n$[]\n$[<identifier>]\n$addToSet\n$bit\n$currentDate\n$each\n$inc\n$max\n$min\n$mul\n$pop\n$position\n$pull\n$pullAll\n$push\n$rename\n$set\n$setOnInsert\n$slice\n$sort\n$unset\u{1f}$addFields\n$bucket\n$bucketAuto\n$changeStream\n$changeStreamSplitLargeEvent\n$collStats\n$count\n$currentOp\n$densify\n$documents\n$facet\n$fill\n$geoNear\n$graphLookup\n$group\n$indexStats\n$limit\n$listClusterCatalog\n$listLocalSessions\n$listSampledQueries\n$listSearchIndexes\n$listSessions\n$lookup\n$match\n$merge\n$out\n$planCacheStats\n$project\n$querySettings\n$queryStats\n$rankFusion\n$redact\n$replaceRoot\n$replaceWith\n$sample\n$score\n$scoreFusion\n$search\n$searchMeta\n$set\n$setWindowFields\n$shardedDataDistribution\n$skip\n$sort\n$sortByCount\n$unionWith\n$unset\n$unwind\n$vectorSearch\u{1f}$accumulator\n$addToSet\n$avg\n$bottom\n$bottomN\n$count\n$covariancePop\n$covarianceSamp\n$derivative\n$expMovingAvg\n$first\n$firstN\n$integral\n$last\n$lastN\n$max\n$maxN\n$median\n$mergeObjects\n$min\n$minN\n$percentile\n$push\n$stdDevPop\n$stdDevSamp\n$sum\n$top\n$topN\u{1f}$abs\n$acos\n$acosh\n$add\n$allElementsTrue\n$and\n$anyElementTrue\n$arrayElemAt\n$arrayToObject\n$asin\n$asinh\n$atan\n$atan2\n$atanh\n$avg\n$binarySize\n$bitAnd\n$bitNot\n$bitOr\n$bitXor\n$bottom\n$bottomN\n$bsonSize\n$ceil\n$cmp\n$concat\n$concatArrays\n$cond\n$const\n$convert\n$cos\n$cosh\n$dateAdd\n$dateDiff\n$dateFromParts\n$dateFromString\n$dateSubtract\n$dateToParts\n$dateToString\n$dateTrunc\n$dayOfMonth\n$dayOfWeek\n$dayOfYear\n$degreesToRadians\n$denseRank\n$derivative\n$divide\n$documentNumber\n$eq\n$exp\n$expMovingAvg\n$filter\n$first\n$firstN\n$floor\n$function\n$getField\n$gt\n$gte\n$hour\n$ifNull\n$in\n$indexOfArray\n$indexOfBytes\n$indexOfCP\n$integral\n$isArray\n$isoDayOfWeek\n$isoWeek\n$isoWeekYear\n$last\n$lastN\n$let\n$literal\n$ln\n$log\n$log10\n$lt\n$lte\n$ltrim\n$map\n$max\n$maxN\n$median\n$mergeObjects\n$meta\n$min\n$minN\n$millisecond\n$minute\n$mod\n$month\n$multiply\n$ne\n$not\n$objectToArray\n$or\n$percentile\n$pow\n$push\n$radiansToDegrees\n$rand\n$range\n$rank\n$reduce\n$regexFind\n$regexFindAll\n$regexMatch\n$replaceAll\n$replaceOne\n$reverseArray\n$round\n$rtrim\n$sampleRate\n$second\n$setDifference\n$setEquals\n$setField\n$setIntersection\n$setIsSubset\n$setUnion\n$shift\n$sin\n$sinh\n$size\n$slice\n$sortArray\n$split\n$sqrt\n$stdDevPop\n$stdDevSamp\n$strcasecmp\n$strLenBytes\n$strLenCP\n$substr\n$substrBytes\n$substrCP\n$subtract\n$sum\n$switch\n$tan\n$tanh\n$toBool\n$toDate\n$toDecimal\n$toDouble\n$toHashedIndexKey\n$toInt\n$toLong\n$toLower\n$toObjectId\n$toString\n$toUUID\n$toUpper\n$trim\n$trunc\n$tsIncrement\n$tsSecond\n$type\n$unsetField\n$week\n$year\n$zip\u{1f}$oid\n$date\n$numberLong\n$numberDouble\n$numberInt\n$numberDecimal\n$binary\n$regularExpression\n$timestamp\n$minKey\n$maxKey\n$symbol\n$code\n$uuid\u{1f}find\nfindOne\naggregate\ncountDocuments\nestimatedDocumentCount\ndistinct\ninsertOne\ninsertMany\nupdateOne\nupdateMany\nreplaceOne\ndeleteOne\ndeleteMany\ncreateIndex\ndropIndex\nbulkWrite\u{1f}runCommand\nadminCommand\ngetCollection\ngetCollectionNames\ngetCollectionInfos\ngetProfilingStatus\nsetProfilingLevel\u{1f}ping\nserverStatus\nhostInfo\nbuildInfo\nlistDatabases\nlistCollections\ndbStats\ncollStats\ncurrentOp\nkillOp\ngetCmdLineOpts\nsetProfilingLevel\ngetProfilingStatus\nvalidate\ncreate\ndrop\ndropDatabase\nisMaster\nhello\nreplSetGetStatus";

#[cfg(test)]
mod tests {
    use super::*;

    fn has(list: &str, needle: &str) -> bool {
        list.split('\n').any(|item| item == needle)
    }

    #[test]
    fn vocabulary_covers_reference_operator_groups() {
        let vocab = completion_vocabulary();
        let groups: Vec<&str> = vocab.split(GROUP_SEPARATOR).collect();
        assert_eq!(groups.len(), 10);

        assert!(has(groups[0], "$jsonSchema"));
        assert!(has(groups[2], "$setOnInsert"));
        assert!(has(groups[3], "$vectorSearch"));
        assert!(has(groups[4], "$topN"));
        assert!(has(groups[5], "$dateTrunc"));
        assert!(has(groups[6], "$uuid"));
        assert!(has(groups[7], "find"));
        assert!(has(groups[8], "runCommand"));
        assert!(has(groups[9], "serverStatus"));
    }
}
